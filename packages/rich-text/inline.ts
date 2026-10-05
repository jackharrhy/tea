import type { SerializableProps, SerializableValue } from "remix/component";

export interface Inline extends SerializableProps {
  type: string;
  text?: string;
  href?: string;
  content?: Inline[];
  styles?: Record<string, boolean | string>;
  [key: string]: SerializableValue;
}
