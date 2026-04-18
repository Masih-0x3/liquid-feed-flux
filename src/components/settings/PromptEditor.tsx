import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Maximize2, Minimize2, Copy, Check, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PromptEditorProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Default editor height in px (inline mode). Default 320. */
  minHeight?: number;
  /** Soft character limit shown in counter. */
  maxLength?: number;
  /** Optional title shown in fullscreen modal. */
  title?: string;
  /** Optional reset handler — shows a "Reset to default" button. */
  onReset?: () => void;
  /** Force monospace + smaller font for prompt/JSON content. Default true. */
  mono?: boolean;
}

export function PromptEditor({
  id,
  value,
  onChange,
  placeholder,
  minHeight = 320,
  maxLength,
  title = 'Edit prompt',
  onReset,
  mono = true,
}: PromptEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  const len = value?.length ?? 0;
  const overLimit = maxLength != null && len > maxLength;
  const nearLimit = maxLength != null && !overLimit && len > maxLength * 0.85;

  const copy = () => {
    navigator.clipboard.writeText(value ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const textareaClass = cn(
    'glass-input w-full resize-y leading-relaxed',
    mono ? 'font-mono text-[13px]' : 'text-sm',
  );

  const counterClass = cn(
    'tabular-nums',
    overLimit ? 'text-destructive font-medium' : nearLimit ? 'text-primary' : 'text-muted-foreground',
  );

  return (
    <div className="space-y-2">
      <div className="relative rounded-md border border-border bg-background/40 overflow-hidden">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className={cn(textareaClass, 'border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0')}
          style={{ height: `${minHeight}px`, maxHeight: '70vh', overflow: 'auto' }}
        />
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 bg-background/80 backdrop-blur" onClick={copy} title="Copy">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 bg-background/80 backdrop-blur" onClick={() => setFullscreen(true)} title="Expand">
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {onReset && (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReset}>
              <RotateCcw className="w-3 h-3 mr-1" />Reset to default
            </Button>
          )}
        </div>
        <div className={counterClass}>
          {len.toLocaleString()}{maxLength ? ` / ${maxLength.toLocaleString()}` : ''} chars
          {overLimit && ' — over limit'}
        </div>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b border-border">
            <DialogTitle className="flex items-center justify-between gap-4">
              <span>{title}</span>
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-normal', counterClass)}>
                  {len.toLocaleString()}{maxLength ? ` / ${maxLength.toLocaleString()}` : ''} chars
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={copy}>
                  {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                  Copy
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setFullscreen(false)}>
                  <Minimize2 className="w-4 h-4 mr-1" />Collapse
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 p-6 overflow-hidden">
            <Textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              className={cn(textareaClass, 'h-full resize-none')}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PromptEditor;
