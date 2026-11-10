import { render } from "@react-email/render";
import { Confirm, type ConfirmProps } from "./templates/confirm";

export async function renderConfirmation(
  props: ConfirmProps,
): Promise<{ html: string }> {
  const html = await render(Confirm(props));
  return { html };
}
