import { Slider } from "@/components/ui/slider";

interface Props {
  value: number;
  onChange: (v: number) => void;
  matchedCount: number;
}

export const ThresholdSlider = ({ value, onChange, matchedCount }: Props) => {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        {/*<div>
          <div className="mt-0.5 text-xs text-subtle">{matchedCount} clusters match</div>
        </div>
        <div className="font-mono text-base tabular-nums">{value.toFixed(2)}
        </div>*/}        
      </div>
      
      <Slider
        min={0.6}
        max={0.9}
        step={0.01}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>0.60</span>
        <span>0.75</span>
        <span>0.90</span>
      </div>
    </div>
  );
};
