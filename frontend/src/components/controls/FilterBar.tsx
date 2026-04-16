import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface Filters {
  query: string;
  language: string;
  minSize: string;
}

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  languages: string[];
}

export const FilterBar = ({ filters, onChange, languages }: Props) => {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-surface p-3 md:flex-row md:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search records or cluster id…"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          className="border-border/70 bg-background/40 pl-9"
        />
      </div>
      <Select value={filters.language} onValueChange={(v) => onChange({ ...filters, language: v })}>
        <SelectTrigger className="w-full md:w-[160px] border-border/70 bg-background/40">
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All languages</SelectItem>
          {languages.map((l) => (
            <SelectItem key={l} value={l}>
              {l.toUpperCase()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.minSize} onValueChange={(v) => onChange({ ...filters, minSize: v })}>
        <SelectTrigger className="w-full md:w-[160px] border-border/70 bg-background/40">
          <SelectValue placeholder="Cluster size" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any size</SelectItem>
          <SelectItem value="2">2+ records</SelectItem>
          <SelectItem value="3">3+ records</SelectItem>
          <SelectItem value="5">5+ records</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
