import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
} from "ai";

export function textStreamResponse<UI_MESSAGE extends UIMessage>(
  originalMessages: UI_MESSAGE[],
  text: string,
  onFinish?: (messages: UI_MESSAGE[]) => Promise<void> | void,
) {
  const stream = createUIMessageStream<UI_MESSAGE>({
    originalMessages,
    execute({ writer }) {
      const id = generateId();
      writer.write({ type: "text-start", id });
      for (const chunk of chunkText(text)) {
        writer.write({ type: "text-delta", id, delta: chunk });
      }
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onFinish: ({ messages }) => onFinish?.(messages),
  });
  return createUIMessageStreamResponse({ stream });
}

function chunkText(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 80) {
    chunks.push(text.slice(i, i + 80));
  }
  return chunks;
}
