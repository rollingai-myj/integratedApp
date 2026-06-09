import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Return the store ID as-is (e.g. "粤28999" or "1534"). */
export function getStoreId(selectedStore: string): string {
  return selectedStore;
}
