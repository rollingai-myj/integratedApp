import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast, toastSuccess } from "@/components/ui/sonner";
import {
  upsertCorrection,
  type CorrectionKind,
  type CorrectionReasonCode,
  type SkuCorrection,
} from "@/components/shelves/services/skuCorrections";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: CorrectionKind;
  skuCode: string;
  skuName: string;
  storeId: string;
  shelfId?: string | null;
  existing?: SkuCorrection | null;
  onSaved?: () => void;
}

const REMOVE_OPTIONS: { code: CorrectionReasonCode; label: string }[] = [
  { code: "stopped_purchase", label: "本店已停止进货" },
  { code: "vip_preferred", label: "个别重要客人喜好，不建议下架" },
  { code: "other", label: "其他（请输入）" },
];
const ADD_OPTIONS: { code: CorrectionReasonCode; label: string }[] = [
  { code: "started_purchase", label: "本店已开始进货" },
  { code: "verified_low_sales", label: "本店在近期已验证此商品销量不佳" },
  { code: "other", label: "其他（请输入）" },
];

function getAccount(): string | null {
  try {
    const raw = sessionStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw).account || null;
  } catch { return null; }
}

export function SkuCorrectionDialog({
  open, onOpenChange, kind, skuCode, skuName, storeId, shelfId, existing, onSaved,
}: Props) {
  const options = kind === "remove" ? REMOVE_OPTIONS : ADD_OPTIONS;
  const [reasonCode, setReasonCode] = useState<CorrectionReasonCode>(options[0].code);
  const [reasonText, setReasonText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReasonCode(existing?.reason_code ?? options[0].code);
      setReasonText(existing?.reason_text ?? "");
    }
  }, [open, existing, options]);

  const isOther = reasonCode === "other";
  const canSubmit = !submitting && (!isOther || reasonText.trim().length > 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await upsertCorrection({
        storeId, skuCode, skuName,
        correctionKind: kind, reasonCode,
        reasonText: isOther ? reasonText.trim() : "",
        shelfId, account: getAccount(),
      });
      toastSuccess("已记录，下次优化将自动跳过该商品");
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            勘误：{kind === "remove" ? "不应下架" : "不应上架"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{skuName}</p>
        </DialogHeader>

        <RadioGroup value={reasonCode} onValueChange={(v) => setReasonCode(v as CorrectionReasonCode)} className="gap-3">
          {options.map((opt) => (
            <div key={opt.code} className="flex items-start gap-2">
              <RadioGroupItem value={opt.code} id={`opt-${opt.code}`} className="mt-0.5" />
              <Label htmlFor={`opt-${opt.code}`} className="text-sm font-normal leading-snug cursor-pointer">
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>

        {isOther && (
          <Textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder="请输入具体原因"
            rows={3}
            className="text-sm"
          />
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "保存中..." : "提交"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
