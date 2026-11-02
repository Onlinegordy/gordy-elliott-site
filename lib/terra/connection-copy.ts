export const connectionFailureCopy: Record<string, string> = {
 attempt_expired: "Not completed in the provider window",
 widget_return_failed: "The provider did not approve the connection",
 provider_auth_error: "The provider reported an authorisation error",
 provider_deauth: "Disconnected by the provider",
 provider_revoked: "Access revoked in the provider account",
 provider_paused: "Paused by Garmin",
 orphan_reference: "Terra user belongs to a deleted profile",
};

export function connectionFailureMessage(reason: string, provider: string) {
 if (reason === "widget_return_failed" && (provider === "apple" || provider === "healthconnect")) {
  return "The health connection wasn't completed. Reconnect to try again.";
 }
 return connectionFailureCopy[reason];
}
