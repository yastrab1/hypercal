export interface ScrollPreferences {
  continuousScroll?: boolean;
  continuousScrollWeb?: boolean;
  continuousScrollPhone?: boolean;
}
export function continuousFor(
  view: ScrollPreferences | null | undefined,
  phone: boolean,
): boolean;
