export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export const num = (id: string) => Number($<HTMLInputElement>(id).value);
export const value = (id: string) => $<HTMLInputElement>(id).value;
export const setValue = (id: string, v: number | string) => {
  $<HTMLInputElement>(id).value = String(v);
};
export const bytes = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
