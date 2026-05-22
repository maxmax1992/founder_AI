"use client";

import { type ReactNode, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { CopyIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface MarkdownProps {
  text: string;
  className?: string;
  isStreaming?: boolean;
  /**
   * Optional override for the image renderer. Used by the paper viewer
   * to turn `![fig pN-I](caption)` markers into figure-reference badges
   * without forking the base prose styles. When omitted, images render
   * with the default `<img>` element (chat parity).
   */
  components?: Components;
}

/**
 * Shared Markdown renderer. Chat bubbles and the paper viewer both use
 * this — keep the className soup byte-identical to what
 * `MessageBubble.Markdown` shipped before the extraction, otherwise
 * chat prose regresses.
 */
export function Markdown({ text, className, components, isStreaming = false }: MarkdownProps) {
  const merged: Components = components ? { ...mdComponents, ...components } : mdComponents;
  const renderedText = isStreaming ? remend(text, { linkMode: "text-only" }) : text;
  return (
    <div
      className={cn(
        "prose-paper text-foreground max-w-none text-[15px] leading-[1.65]",
        "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold",
        "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold",
        "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1",
        "[&_a]:text-brand [&_a]:decoration-brand/40 hover:[&_a]:decoration-brand [&_a]:underline [&_a]:underline-offset-2",
        "[&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:pl-4",
        "[&_hr]:border-border [&_hr]:my-4",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
        "[&_th]:border-border [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border-border [&_td]:border [&_td]:px-2 [&_td]:py-1",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={merged}>
        {renderedText}
      </ReactMarkdown>
    </div>
  );
}

const mdComponents: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  code({ className, children, ...rest }) {
    const isBlock = typeof className === "string" && /language-/.test(className);
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[13px]", className)} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.92em]" {...rest}>
        {children}
      </code>
    );
  },
};

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = extractTextContent(children);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group border-border bg-muted relative my-3 overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy code"
        className="border-border bg-background/80 text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute top-2 right-2 flex size-7 items-center justify-center rounded-md border opacity-0 backdrop-blur-sm transition-opacity outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
      >
        {copied ? (
          <span className="text-xs font-medium">Copied</span>
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </button>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-[1.5]">{children}</pre>
    </div>
  );
}

function extractTextContent(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: ReactNode } }).props;
    return extractTextContent(props.children);
  }
  return "";
}
