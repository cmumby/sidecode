import { useRef, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
function CodeBlock({ children }: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null);
  const [label, setLabel] = useState('Copy code');
  return <div className="code-block"><button onClick={() => {
    void navigator.clipboard.writeText(ref.current?.textContent ?? '').then(() => setLabel('Copied'), () => setLabel('Select code to copy'));
  }}>{label}</button><pre ref={ref}>{children}</pre></div>;
}
export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml rehypePlugins={[rehypeHighlight]} components={{
    pre: CodeBlock,
    a: ({ children }) => <span>{children}</span>,
    img: ({ alt }) => <span>[Image: {alt || 'attachment'}]</span>,
  }}>{text}</ReactMarkdown></div>;
}
