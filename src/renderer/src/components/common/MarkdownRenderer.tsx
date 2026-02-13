import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import CodeBlock from './CodeBlock'

interface Props {
  content: string
}

export default function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isInline = !match
          if (isInline) {
            return <code className="inline-code" {...props}>{children}</code>
          }
          return (
            <CodeBlock language={match[1]}>
              {String(children).replace(/\n$/, '')}
            </CodeBlock>
          )
        }
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
