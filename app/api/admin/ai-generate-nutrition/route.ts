import { requireAdmin } from "@/lib/admin-auth";
import { selectFoodsForPrompt } from "@/lib/food-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { assertAiSourceAllowed } from "@/lib/ai-source-policy.mjs";

type GeneratedMealItem = {
  food_id: string;
  quantity?: number;
  order_index?: number;
  notes?: string;
};

type GeneratedMeal = {
  name: string;
  order_index?: number;
  notes?: string;
  items?: GeneratedMealItem[];
};

type GeneratedPlan = {
  name: string;
  description?: string;
  calorie_range?: string;
  target_calories?: number;
  target_protein_g?: number;
  target_carbs_g?: number;
  target_fat_g?: number;
  target_fibre_g?: number;
  target_sugar_g?: number;
  meals?: GeneratedMeal[];
};

type FoodForPrompt = {
  id: string;
  name: string;
  category: string;
  serving_size: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g?: number;
  sugar_g?: number;
};

const GORDY_NUTRITION_RULEBOOK = `
GORDY'S NUTRITION TEMPLATE RULEBOOK
- These are templates, not prescriptions. Build useful starting points that Gordy can customise.
- Protein is anchored every meal: palm-sized minimum at meals, hand-sized at breakfast where possible.
- Carbs scale to calorie tier and time of day: more around training, less late evening unless the brief says otherwise.
- Fats stay moderate: not fat-phobic, not fat-heavy.
- Veg or fruit appears at every meal except the snack.
- Added/non-fruit sugar stays under roughly 30g/day. Fruit and dairy are allowed; do not imply "low sugar" means no fruit.
- Snacks are always protein-led, not carb-led.
- Calorie accuracy is approximate. Do not pretend a generated template is exact to the calorie, but if the coach asks for a calorie target, that target is mandatory and should be hit within about 50-100 kcal.
- 1300 kcal is a low fat-loss tier. Do not make it the default for large or very active clients.

PROTEIN TARGETS
- 1300 kcal: about 130g protein
- 1500 kcal: about 145-150g protein
- 1700 kcal: about 160g protein
- 2100 kcal: about 175-180g protein

REFERENCE STYLE
- 1300 examples: Reset, Office Day, Easy Cook. Simple proteins like eggs, chicken, tuna, turkey mince, yoghurt, salmon, steak.
- 1500 examples: Standard, Lifter's Cut. Omelette or oats, chicken/rice, cottage cheese/yoghurt, cod/chicken/steak.
- 1700 examples: Working Day, Maintenance. Eggs/bacon or yoghurt/granola, pasta/rice bowls, protein-led snack, salmon/chicken dinner.
- 2100 examples: Active Day, Lifter, Big Day. Higher portions, still structured, protein high, carbs around training.
- Build in practical swap notes: chicken/turkey/beef; salmon/cod/tuna/prawns; rice/pasta/potato/quinoa where macros are close.
`;

function extractJson(text: string): GeneratedPlan {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

function detectRequestedCalories(prompt: string): number | null {
  const match = prompt.match(/\b(1[2-9]\d{2}|2\d{3}|3\d{3}|4\d{3})\s*(?:kcal|cal|calorie|calories)?\b/i);
  return match ? Number(match[1]) : null;
}

function detectDietaryConstraints(prompt: string) {
  const lower = prompt.toLowerCase();
  const dairyFree = /\b(dairy[-\s]?free|dairy intolerant|lactose intolerant|no dairy|without dairy|dairy allergy)\b/.test(lower);
  const glutenFree = /\b(gluten[-\s]?free|coeliac|celiac|no gluten|without gluten)\b/.test(lower);
  const eggFree = /\b(egg[-\s]?free|egg intolerant|egg allergy|no eggs|without eggs)\b/.test(lower);
  const fishFree = /\b(fish[-\s]?free|fish allergy|no fish|without fish|doesn'?t eat fish|hates fish)\b/.test(lower);
  const vegetarian = /\bvegetarian\b/.test(lower);
  const vegan = /\bvegan\b/.test(lower);

  return { dairyFree, glutenFree, eggFree, fishFree, vegetarian, vegan };
}

function foodMatchesAny(food: FoodForPrompt, patterns: RegExp[]) {
  const text = `${food.name} ${food.category} ${food.serving_size}`.toLowerCase();
  return patterns.some((pattern) => pattern.test(text));
}

function filterFoodsForConstraints(foods: FoodForPrompt[], constraints: ReturnType<typeof detectDietaryConstraints>) {
  const exclusions: string[] = [];
  let filtered = foods;

  if (constraints.dairyFree || constraints.vegan) {
    const dairyPatterns = [
      /\bdairy\b/,
      /\bmilk\b/,
      /\bwhey\b/,
      /\bcasein\b/,
      /\byogh?urt\b/,
      /\bcheese\b/,
      /\bcottage\b/,
      /\bfeta\b/,
      /\bcream\b/,
      /\bbutter\b/,
      /\bkefir\b/,
    ];
    filtered = filtered.filter((food) => !foodMatchesAny(food, dairyPatterns));
    exclusions.push("dairy, lactose, whey, yoghurt, milk, cheese, butter, and casein");
  }

  if (constraints.glutenFree) {
    const glutenPatterns = [/\bwheat\b/, /\bbread\b/, /\bsourdough\b/, /\bwrap\b/, /\bpasta\b/, /\bgluten\b/, /\bcereal\b/];
    filtered = filtered.filter((food) => !foodMatchesAny(food, glutenPatterns));
    exclusions.push("wheat, bread, wraps, pasta, cereal, and gluten-containing foods");
  }

  if (constraints.eggFree || constraints.vegan) {
    filtered = filtered.filter((food) => !foodMatchesAny(food, [/\begg\b/, /\beggs\b/]));
    exclusions.push("eggs");
  }

  if (constraints.fishFree || constraints.vegan || constraints.vegetarian) {
    const fishPatterns = [/\bfish\b/, /\bsalmon\b/, /\bcod\b/, /\btuna\b/, /\bprawn\b/, /\bshrimp\b/, /\bhaddock\b/];
    filtered = filtered.filter((food) => !foodMatchesAny(food, fishPatterns));
    exclusions.push("fish and seafood");
  }

  if (constraints.vegan || constraints.vegetarian) {
    const meatPatterns = [/\bchicken\b/, /\bturkey\b/, /\bbeef\b/, /\bsteak\b/, /\bmince\b/, /\bbacon\b/, /\bham\b/, /\bpork\b/, /\blamb\b/];
    filtered = filtered.filter((food) => !foodMatchesAny(food, meatPatterns));
    exclusions.push("meat");
  }

  return { foods: filtered, exclusions };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { prompt } = await req.json();
  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt required" }, { status: 400 });
  try { assertAiSourceAllowed(prompt); } catch { return NextResponse.json({ error: "Imported Garmin data cannot be processed by AI." }, { status: 400 }); }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  const admin = createAdminClient();
  const { data: foods, error: foodsError } = await admin
    .from("foods")
    .select("id, name, category, serving_size, calories, protein_g, carbs_g, fat_g, fibre_g, sugar_g")
    .eq("is_active", true)
    .order("category");

  if (foodsError) return NextResponse.json({ error: foodsError.message }, { status: 500 });
  if (!foods?.length) return NextResponse.json({ error: "Add foods to the food library before generating a plan." }, { status: 400 });

  const requestedCalories = detectRequestedCalories(prompt);
  const constraints = detectDietaryConstraints(prompt);
  const { foods: foodsAllowedByConstraints, exclusions } = filterFoodsForConstraints(foods, constraints);

  if (!foodsAllowedByConstraints.length) {
    return NextResponse.json({ error: "No foods match those dietary constraints. Add suitable foods to the library first." }, { status: 400 });
  }

  const foodShortlist = selectFoodsForPrompt(foodsAllowedByConstraints, prompt, {
    maxFoods: 180,
    maxPerCategory: 22,
  });
  const hardConstraintText = [
    requestedCalories ? `Requested calorie target: ${requestedCalories} kcal. This is mandatory. Set target_calories to ${requestedCalories} and build meals to land within roughly 50-100 kcal of it.` : null,
    exclusions.length > 0 ? `Dietary exclusions detected from the coach brief: ${exclusions.join("; ")}. These are hard constraints. Do not use, mention as ingredients, or substitute in any excluded food.` : null,
    constraints.dairyFree ? "Dairy-free means no whey protein, yoghurt/yogurt, milk, cheese, cottage cheese, feta, butter, cream, kefir, casein, or dairy-based protein bars." : null,
    constraints.vegan ? "Vegan means no meat, fish, eggs, dairy, whey, casein, or honey." : null,
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are Gordy Elliott's admin-side nutrition template assistant. Generate practical, editable meal-plan templates for Gordy to review before assigning to clients.

${GORDY_NUTRITION_RULEBOOK}

AVAILABLE FOODS
Use only these exact food IDs. Quantity is a multiplier of serving_size. If a food is not listed here, it is unavailable or excluded.
${JSON.stringify(foodShortlist)}

HARD CONSTRAINTS FROM THIS COACH BRIEF
${hardConstraintText || "No explicit calorie or exclusion constraint detected. Still follow the coach's brief exactly."}

Return JSON only with this shape:
{
  "name": "Plan name",
  "description": "Brief coach-facing description including any caveat or swap logic",
  "calorie_range": "low|moderate|high|custom",
  "target_calories": number,
  "target_protein_g": number,
  "target_carbs_g": number,
  "target_fat_g": number,
  "target_fibre_g": number,
  "target_sugar_g": number,
  "meals": [
    {
      "name": "Breakfast",
      "order_index": 0,
      "notes": "Short practical note",
      "items": [
        { "food_id": "uuid from available foods", "quantity": 1, "order_index": 0, "notes": "optional portion cue" }
      ]
    }
  ]
}

Design rules:
- Make 3 meals plus 1 protein-led snack unless the brief asks otherwise.
- The coach's requested calorie number overrides your defaults. Do not silently move 1800 to 2000, 1500 to 1700, etc.
- Hit the calorie and macro targets as closely as the available foods allow.
- Set target_fibre_g to at least 25g where practical.
- Set target_sugar_g as the daily sugar cap, usually 30g unless the brief says otherwise.
- Respect allergies, intolerances, dislikes, schedule constraints, and calorie tier in the prompt as hard constraints, not preferences.
- If dairy-free/lactose-intolerant is requested, never use whey protein, yoghurt/yogurt, milk, cheese, cottage cheese, feta, butter, cream, kefir, or casein.
- Keep the template coach-editable: clear names, short notes, no client-facing medical claims.
- If the brief asks for an unsafe/default 1300 kcal plan for a large or highly active client, include the caution in description and bias toward "Gordy review required".`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: `Create this Gordy nutrition template: ${prompt}\n\nJSON only.` }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("AI nutrition generation failed:", err);
      return NextResponse.json({ error: "AI generation failed" }, { status: 502 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    let plan: GeneratedPlan;
    try {
      plan = extractJson(text);
    } catch {
      return NextResponse.json({ error: "AI returned invalid nutrition JSON", raw: text }, { status: 502 });
    }

    const validFoodIds = new Set(foodShortlist.map((food) => food.id));
    const meals = plan.meals || [];

    if (!plan.name || meals.length === 0) {
      return NextResponse.json({ error: "AI returned an incomplete plan", raw: plan }, { status: 502 });
    }

    const { data: template, error: templateError } = await admin
      .from("nutrition_templates")
      .insert({
        name: plan.name,
        description: plan.description || null,
        plan_type: "full",
        calorie_range: plan.calorie_range || "moderate",
        target_calories: requestedCalories || plan.target_calories || null,
        target_protein_g: plan.target_protein_g || null,
        target_carbs_g: plan.target_carbs_g || null,
        target_fat_g: plan.target_fat_g || null,
        target_fibre_g: plan.target_fibre_g || 30,
        target_sugar_g: plan.target_sugar_g || 30,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });

    for (const [mealIndex, meal] of meals.entries()) {
      const { data: savedMeal, error: mealError } = await admin
        .from("nutrition_template_meals")
        .insert({
          template_id: template.id,
          name: meal.name || `Meal ${mealIndex + 1}`,
          order_index: meal.order_index ?? mealIndex,
          notes: meal.notes || null,
        })
        .select()
        .single();

      if (mealError) return NextResponse.json({ error: mealError.message }, { status: 500 });

      const validItems = (meal.items || []).filter((item) => validFoodIds.has(item.food_id));
      if (!validItems.length) continue;

      const { error: itemsError } = await admin
        .from("nutrition_template_meal_items")
        .insert(
          validItems.map((item, itemIndex) => ({
            meal_id: savedMeal.id,
            food_id: item.food_id,
            quantity: item.quantity || 1,
            order_index: item.order_index ?? itemIndex,
            notes: item.notes || null,
          })),
        );

      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json({ template, plan });
  } catch (err) {
    console.error("AI nutrition generation failed:", err);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
