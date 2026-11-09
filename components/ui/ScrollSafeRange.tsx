"use client";

import { useRef, useState, type InputHTMLAttributes, type PointerEvent } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: string) => void;
};

/** A vertical swipe may start on the track without changing the saved answer. */
export default function ScrollSafeRange({ value, onValueChange, ...props }: Props) {
  const gesture = useRef<{ id: number; x: number; y: number; pending: string | null; direction: "pending" | "horizontal" | "vertical" } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function cancel() {
    gesture.current = null;
    setPreview(null);
  }

  function move(event: PointerEvent<HTMLInputElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || current.direction !== "pending") return;
    const dx = Math.abs(event.clientX - current.x);
    const dy = Math.abs(event.clientY - current.y);
    if (Math.max(dx, dy) >= 8) current.direction = dx > dy ? "horizontal" : "vertical";
  }

  return <input
    {...props}
    type="range"
    value={preview ?? value}
    onPointerDown={event => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pending: null, direction: "pending" };
    }}
    onPointerMove={move}
    onPointerUp={event => {
      move(event);
      const current = gesture.current;
      if (!current) {
        if (event.pointerType === "mouse") onValueChange(event.currentTarget.value);
        return;
      }
      if (current.id !== event.pointerId) return;
      const next = current.direction !== "vertical" ? current.pending ?? event.currentTarget.value : null;
      cancel();
      if (next !== null) onValueChange(next);
    }}
    onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onBlur={cancel}
    onKeyUp={event => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onValueChange(event.currentTarget.value);
    }}
    onChange={event => {
      const current = gesture.current;
      if (!current) { onValueChange(event.target.value); return; }
      current.pending = event.target.value;
      if (current.direction === "horizontal") setPreview(event.target.value);
    }}
  />;
}
