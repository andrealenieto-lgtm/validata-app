import { TextField } from "@shopify/polaris";

/** Campo de color: selector nativo para elegir y texto para escribir el código (#rrggbb). */
export function CampoColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      autoComplete="off"
      prefix={
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: 0,
            background: "none",
            cursor: "pointer",
          }}
        />
      }
    />
  );
}
