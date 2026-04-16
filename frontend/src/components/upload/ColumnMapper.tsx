import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Props {
  columns: string[];
  textColumn: string;
  languageColumn: string;
  idColumn: string;
  onChange: (next: { textColumn: string; languageColumn: string; idColumn: string }) => void;
}

const fields: { key: "idColumn" | "textColumn" | "languageColumn"; label: string; hint: string }[] = [
  { key: "idColumn", label: "ID column", hint: "Unique record identifier" },
  { key: "textColumn", label: "Text column", hint: "Field used for similarity" },
  { key: "languageColumn", label: "Language column", hint: "ISO code or auto-detected" },
];

export const ColumnMapper = ({ columns, textColumn, languageColumn, idColumn, onChange }: Props) => {
  const values = { idColumn, textColumn, languageColumn };

  const options = {
    idColumn: [{ value: "__auto__", label: "Auto generate IDs" }, ...columns.map((column) => ({ value: column, label: column }))],
    textColumn: columns.map((column) => ({ value: column, label: column })),
    languageColumn: [{ value: "__auto__", label: "Default to en" }, ...columns.map((column) => ({ value: column, label: column }))],
  } as const;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {fields.map((f) => (
        <div key={f.key} className="rounded-2xl border border-border/60 bg-surface p-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            {f.label}
          </Label>
          <Select
            value={values[f.key] || "__auto__"}
            onValueChange={(v) =>
              onChange({
                ...values,
                [f.key]: v === "__auto__" ? "" : v,
              })
            }
          >
            <SelectTrigger className="mt-2 border-border/70 bg-background/40">
              <SelectValue placeholder="Select column" />
            </SelectTrigger>
            <SelectContent>
              {options[f.key].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-subtle">{f.hint}</p>
        </div>
      ))}
    </div>
  );
};
