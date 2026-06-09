import { useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast, toastSuccess } from "@/components/ui/sonner";
import { parseExcelRows, createImportedStores, type ImportRow } from "@/components/shelves/services/importedStores";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImported?: () => void;
}

const REQUIRED_COLS = [
  "门店编号","大类编号","大类名称","中类编号","中类名称","小类编号","小类名称",
  "商品编号","商品名称","品牌","规格","计量单位","保质期","createdate","库存",
  "30日销售额","30日销售额环比","30日销量",
];

export default function ImportStoreDialog({ open, onOpenChange, onImported }: Props) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [storeGroups, setStoreGroups] = useState<{ storeId: string; count: number }[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFileName(""); setRows([]); setStoreGroups([]); setLabels({});
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      if (json.length === 0) {
        toast.error("Excel 没有数据");
        setLoading(false); return;
      }
      const cols = Object.keys(json[0]);
      const missing = REQUIRED_COLS.filter((c) => !cols.includes(c));
      if (missing.length > 0) {
        toast.error(`Excel 缺少字段：${missing.join("、")}`);
        setLoading(false); return;
      }
      const parsed = parseExcelRows(json);
      const groupMap = new Map<string, { storeId: string; count: number }>();
      for (const r of parsed) {
        const key = r.storeId;
        if (!key) continue;
        const cur = groupMap.get(key);
        if (cur) cur.count++;
        else groupMap.set(key, { storeId: key, count: 1 });
      }
      const groups = Array.from(groupMap.values());
      setRows(parsed);
      setStoreGroups(groups);
      setLabels(Object.fromEntries(groups.map((g) => [g.storeId, ""])));
      setFileName(file.name);
    } catch (e: any) {
      toast.error("解析失败：" + (e.message || ""));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = storeGroups.length > 0 && storeGroups.every((g) => labels[g.storeId]?.trim());

  const submit = async () => {
    setSubmitting(true);
    try {
      const meta = storeGroups.map((g) => ({
        storeId: g.storeId,
        storeLabel: labels[g.storeId].trim(),
      }));
      const res = await createImportedStores({ storeMeta: meta, skuRows: rows });
      if (res.created === 0) {
        toast.error(`所有门店编号已存在：${res.skipped.join("、")}`);
      } else {
        toastSuccess(`成功导入 ${res.created} 家门店${res.skipped.length ? `（跳过已存在：${res.skipped.join("、")}）` : ""}`);
        onImported?.();
        onOpenChange(false);
        reset();
      }
    } catch (e: any) {
      toast.error("导入失败：" + (e.message || ""));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>导入门店</DialogTitle>
          <DialogDescription className="text-xs">
            上传与模板字段一致的 Excel（.xlsx）。系统会按"门店编号"分组建店，账号 = 门店编号（纯数字），初始密码 123456。
          </DialogDescription>
        </DialogHeader>

        {!fileName ? (
          <label className="block border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition">
            <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {loading ? "解析中…" : "点击选择 Excel 文件 (.xlsx)"}
            </p>
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              必须包含字段：{REQUIRED_COLS.join("、")}
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              disabled={loading}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs bg-muted/50 rounded p-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              <span className="flex-1 truncate">{fileName}</span>
              <span className="text-muted-foreground">{rows.length} 行 · {storeGroups.length} 家门店</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={reset}>更换</Button>
            </div>

            <div>
              <Label className="text-xs mb-1.5 block">为每个新门店填写名称（必填）</Label>
              <ScrollArea className="max-h-[260px] border rounded-md">
                <div className="p-2 space-y-2">
                  {storeGroups.map((g) => (
                    <div key={g.storeId} className="flex items-center gap-2">
                      <div className="text-xs font-mono w-20 shrink-0">{g.storeId}</div>
                      <div className="text-[10px] text-muted-foreground w-12 shrink-0">{g.count} 条</div>
                      <Input
                        value={labels[g.storeId] || ""}
                        onChange={(e) => setLabels({ ...labels, [g.storeId]: e.target.value })}
                        placeholder="例如：东莞南城东园大厦"
                        className="h-7 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={submit} disabled={!canSubmit || submitting}>
            {submitting && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            创建门店
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
