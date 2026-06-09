/**
 * Extract the Dify `user` identifier from the JWT session.
 * - Store accounts: returns the 9-digit account number
 * - Admin accounts: returns "admin-{storeId}" (e.g., "admin-28999")
 */
export function getDifyUser(): string {
  try {
    const raw = sessionStorage.getItem("auth_user");
    if (!raw) return "anonymous";
    const { token } = JSON.parse(raw) as { token?: string };
    if (!token) return "anonymous";
    const parts = token.split(".");
    if (parts.length !== 3) return "anonymous";
    const payload = JSON.parse(atob(parts[1])) as {
      account?: string;
      storeId?: string;
      isAdmin?: boolean;
    };
    if (payload.isAdmin) {
      const selectedStore = localStorage.getItem("selectedStore") || "";
      return `admin-${selectedStore}`;
    }
    return payload.account || "anonymous";
  } catch {
    return "anonymous";
  }
}
