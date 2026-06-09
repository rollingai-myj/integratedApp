/**
 * 选品调研对话框 — 聊天气泡风格，依次询问问题生成智能体返回的动态问题
 */
import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/components/shelves/lib/utils";
import { Send, Sparkles, Mic, Check } from "lucide-react";
import { toast } from "@/components/shelves/hooks/use-toast";
import type { InsightQuestion } from "@/components/shelves/lib/difyInsightApi";
import type { SurveyQA } from "@/components/shelves/services/shelfSurvey";

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: (answers: SurveyQA[]) => void;
  questions: InsightQuestion[];
}

interface ChatMessage {
  role: "ai" | "user";
  content: string;
}

export const SelectionSurveyDialog = ({ open, onClose, onComplete, questions }: Props) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [step, setStep] = useState(0);
  const [customText, setCustomText] = useState("");
  const [collected, setCollected] = useState<SurveyQA[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      if (questions.length === 0) {
        // No questions to ask — auto-complete with empty
        onComplete([]);
        return;
      }
      const first = questions[0];
      const intro = first.context
        ? `${first.context}\n\n${first.question}`
        : first.question;
      setMessages([{ role: "ai", content: intro }]);
      setStep(0);
      setCustomText("");
      setCollected([]);
      setMultiSelected(new Set());
      setTimeout(() => setShowPresets(true), 400);
    } else {
      setMessages([]);
      setShowPresets(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, questions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showPresets, multiSelected]);

  const advanceToNext = (rawAnswer: string) => {
    const q = questions[step];
    if (!q) return;
    const qa: SurveyQA = {
      id: q.id,
      question: q.question,
      direction: q.direction,
      context: q.context,
      options: q.options,
      answer: rawAnswer.trim(),
    };
    const updated = [...collected, qa];
    setCollected(updated);

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: rawAnswer }];
    setShowPresets(false);
    setCustomText("");
    setMultiSelected(new Set());

    if (step < questions.length - 1) {
      const nextStep = step + 1;
      setStep(nextStep);
      const nextQ = questions[nextStep];
      const intro = nextQ.context ? `${nextQ.context}\n\n${nextQ.question}` : nextQ.question;
      const withAi: ChatMessage[] = [...newMessages, { role: "ai", content: intro }];
      setMessages(newMessages);
      setTimeout(() => {
        setMessages(withAi);
        setTimeout(() => setShowPresets(true), 400);
      }, 500);
    } else {
      setMessages(newMessages);
      onComplete(updated);
      setStep(0);
      setCustomText("");
      setCollected([]);
    }
  };

  const sendAnswer = (answer: string) => {
    if (!answer) return;
    advanceToNext(answer);
  };

  const currentQ = questions[step];
  const currentPresets = currentQ?.options || [];

  const handleMultiToggle = (label: string) => {
    const next = new Set(multiSelected);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setMultiSelected(next);
    setCustomText(Array.from(next).join("、"));
  };

  const hasCustomText = customText.trim().length > 0;

  const startVoice = () => {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "当前浏览器不支持语音输入", description: "请使用 Chrome / Edge / Safari 最新版本" });
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "zh-CN";
      rec.interimResults = true;
      rec.continuous = true;
      baseTextRef.current = customText ? customText + (customText.endsWith("、") || customText.endsWith(" ") ? "" : " ") : "";
      rec.onresult = (e: any) => {
        let txt = "";
        for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        setCustomText(baseTextRef.current + txt);
      };
      rec.onerror = () => setIsRecording(false);
      rec.onend = () => setIsRecording(false);
      recognitionRef.current = rec;
      rec.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const stopVoice = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setIsRecording(false);
  };

  const handleClose = () => {
    stopVoice();
    setStep(0);
    setCustomText("");
    setCollected([]);
    setMessages([]);
    setMultiSelected(new Set());
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-[380px] sm:max-w-[440px] p-0 gap-0 overflow-hidden flex flex-col" style={{ maxHeight: "80vh" }} onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">回答几个问题，帮助 AI 更好地分析</p>
          </div>
        </div>

        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: 200 }}>
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
                msg.role === "ai"
                  ? "bg-muted text-foreground rounded-tl-sm"
                  : "bg-primary text-primary-foreground rounded-tr-sm"
              )}>
                {msg.content}
              </div>
            </div>
          ))}

          {showPresets && currentPresets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 pl-1">
              {currentPresets.map(label => {
                const isActive = multiSelected.has(label);
                return (
                  <button
                    key={label}
                    onClick={() => handleMultiToggle(label)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-all border text-left",
                      isActive
                        ? "bg-primary/10 text-primary border-primary/50"
                        : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t px-3 pt-2.5 pb-10 flex items-center gap-2 bg-background relative">
          <Input
            placeholder="输入或点击右侧麦克风说话..."
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && hasCustomText) sendAnswer(customText.trim()); }}
            className="flex-1 h-9 text-sm rounded-full bg-muted/50 border-0 focus-visible:ring-1"
          />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={startVoice}
            className="h-8 w-8 rounded-full shrink-0"
          >
            <Mic className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            onClick={() => sendAnswer(customText.trim())}
            disabled={!hasCustomText}
            className="h-8 w-8 rounded-full shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Voice recording overlay */}
        {isRecording && (
          <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-primary flex items-center justify-center">
                <Mic className="w-9 h-9 text-primary-foreground" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">正在聆听…</p>
            <div className="w-full max-w-[320px] min-h-[80px] max-h-[200px] overflow-y-auto rounded-2xl bg-muted px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
              {customText || <span className="text-muted-foreground">说点什么…</span>}
            </div>
            <Button
              onClick={stopVoice}
              className="rounded-full px-8 gap-2"
            >
              <Check className="w-4 h-4" /> 完成
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export type { SurveyQA } from "@/components/shelves/services/shelfSurvey";
