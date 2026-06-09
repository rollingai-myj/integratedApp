import { Users, Swords, BarChart2 } from "lucide-react";
import type { DiagnosisResult } from "@/components/shelves/services/difyAlignApi";

interface Props {
  diagnosis: DiagnosisResult;
}

const SECTIONS = [
  { key: "paragraph_customer" as const, label: "客群分析", Icon: Users, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
  { key: "paragraph_competition" as const, label: "竞争分析", Icon: Swords, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
  { key: "paragraph_status" as const, label: "现状分析", Icon: BarChart2, color: "text-green-600", bg: "bg-green-50", border: "border-green-100" },
];

export const DiagnosisListPanel = ({ diagnosis }: Props) => {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">货架诊断</span>
      </div>
      <div className="divide-y divide-border">
        {SECTIONS.map(({ key, label, Icon, color, bg, border }) => {
          const text = diagnosis[key];
          if (!text) return null;
          return (
            <div key={key} className="px-3 py-3 flex gap-3">
              <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-lg ${bg} ${border} border flex items-center justify-center`}>
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold mb-1 ${color}`}>{label}</p>
                <p className="text-xs text-foreground leading-relaxed">{text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
