/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export interface ConfirmProps {
  confirmUrl: string;
  listNames: string[];
}

export function Confirm({ confirmUrl, listNames }: ConfirmProps) {
  const listLabel =
    listNames.length === 1 ? listNames[0] : listNames.join(", ");

  return (
    <Html>
      <Head />
      <Preview>{`Confirm your subscription to ${listLabel}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={heading}>Confirm your subscription</Text>
          <Text style={paragraph}>
            You asked to subscribe to <strong>{listLabel}</strong>. Click the
            button below to confirm.
          </Text>
          <Button href={confirmUrl} style={button}>
            Confirm subscription
          </Button>
          <Text style={footnote}>
            If you didn't request this, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#ffffff",
  fontFamily:
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const container = {
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "600px",
};

const heading = {
  fontSize: "22px",
  fontWeight: 600 as const,
  color: "#1a1a1a",
  margin: "0 0 16px",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "26px",
  color: "#1a1a1a",
  margin: "0 0 24px",
};

const button = {
  backgroundColor: "#1a1a1a",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block" as const,
  fontSize: "15px",
  fontWeight: 600 as const,
  lineHeight: "48px",
  textAlign: "center" as const,
  textDecoration: "none",
  width: "100%",
};

const footnote = {
  fontSize: "13px",
  lineHeight: "20px",
  color: "#999999",
  marginTop: "24px",
};
