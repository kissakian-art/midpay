export const colors = {
  bg: "#000000",
  surface: "#121212",
  card: "#1c1c1e",
  border: "#2c2c2e",
  text: "#ffffff",
  dim: "#9a9a9e",
  accent: "#ffb300", // MidPay gold
  danger: "#ff453a",
  success: "#32d74b",
};

export const ugx = (n: number | null | undefined) =>
  n == null ? "" : `${n.toLocaleString("en-UG")} UGX`;
