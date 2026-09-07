import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="markdown-content">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="markdown-image-placeholder">
              {alt ? `[Image: ${alt}]` : "[Image omitted]"}
            </span>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
