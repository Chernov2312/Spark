import { useEffect, useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachments } from "../api";

const markdownComponents = {
  a({ node: _node, href, children, ...props }) {
    if (!href || !/^(?:https?:\/\/|mailto:|#)/i.test(href)) return <span>{children}</span>;
    const external = /^https?:\/\//i.test(href);
    return (
      <a {...props} href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
        {children}
      </a>
    );
  },
  img({ src, alt, title }) {
    if (!src || !/^https?:\/\//i.test(src)) return alt || null;
    return <img src={src} alt={alt || ""} title={title} loading="lazy" referrerPolicy="no-referrer" />;
  },
  table({ node: _node, ...props }) {
    return <div className="markdown-body__table"><table {...props} /></div>;
  },
};

export default function MarkdownAttachmentPreview({ id, text, fileName }) {
  const documentId = useId();
  const [download, setDownload] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (text != null) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const url = await attachments.getAttachmentDownloadUrl(id, { signal });
        if (signal.aborted) return;
        const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("Markdown download failed");
        const content = await response.text();
        if (!signal.aborted) setDownload({ content });
      } catch {
        if (!signal.aborted) setDownload({ failed: true });
      }
    }
    load();
    return () => controller.abort();
  }, [id, text, attempt]);

  const source = text ?? download?.content;
  if (source == null) {
    return (
      <div className="markdown-attachment__content markdown-attachment__status" role="status">
        {download?.failed ? (
          <>
            Не удалось загрузить Markdown.
            <button type="button" onClick={() => {
              setDownload(null);
              setAttempt((previous) => previous + 1);
            }}>Повторить</button>
          </>
        ) : "Загрузка Markdown…"}
      </div>
    );
  }
  if (!source.trim()) {
    return <div className="markdown-attachment__content markdown-attachment__status" role="status">Файл пуст.</div>;
  }
  return (
    <div className="markdown-attachment__content markdown-body" role="region" aria-label={`Предпросмотр ${fileName}`} tabIndex={0}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: `markdown-${documentId}-`, footnoteLabel: "Сноски" }}
        components={markdownComponents}
        skipHtml
      >
        {source}
      </Markdown>
    </div>
  );
}
