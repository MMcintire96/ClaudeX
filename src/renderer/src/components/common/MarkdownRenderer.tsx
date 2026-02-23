import React, { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import CodeBlock from './CodeBlock'

interface Props {
  content: string
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText(node.props.children)
  }
  return ''
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
          const plainText = extractText(children).replace(/\n$/, '')
          return (
            <CodeBlock language={match[1]} copyText={plainText}>
              {children}
            </CodeBlock>
          )
        }
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
