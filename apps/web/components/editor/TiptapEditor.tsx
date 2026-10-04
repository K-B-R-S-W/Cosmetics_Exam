"use client";

import { Extension, getHTMLFromFragment, type Extensions } from "@tiptap/core";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";

import { FontSize } from "@/components/editor/FontSize";

interface TiptapEditorProps {
  ariaLabel: string;
  disabled?: boolean;
  headings?: boolean;
  error?: string;
  maxLength: number;
  onChange: (html: string) => void;
  value: string;
}

function maxHtmlLength(maxLength: number, onLimitReached: () => void) {
  return Extension.create({
    name: "maxHtmlLength",
    addProseMirrorPlugins() {
      return [new Plugin({
        filterTransaction(transaction) {
          if (!transaction.docChanged) return true;
          const nextLength = getHTMLFromFragment(transaction.doc.content, transaction.doc.type.schema).length;
          if (nextLength <= maxLength) return true;
          queueMicrotask(onLimitReached);
          return false;
        },
      })];
    },
  });
}

export function createEditorExtensions(headings: boolean, maxLength: number, onLimitReached: () => void = () => undefined): Extensions {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: headings ? { levels: [2, 3] } : false,
      horizontalRule: false,
      link: false,
      underline: false,
    }),
    Underline,
    TextStyle,
    FontSize,
    maxHtmlLength(maxLength, onLimitReached),
  ];
}

const toolbarButton = "min-h-11 min-w-11 border border-line bg-surface px-2 font-bold hover:bg-selected disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted";

export function TiptapEditor({ ariaLabel, disabled = false, headings = true, error, maxLength, onChange, value }: TiptapEditorProps) {
  const [limitReached, setLimitReached] = useState(false);
  const language = /[\u0D80-\u0DFF]/u.test(value) ? "si" : "en";
  const errorId = `${ariaLabel.replace(/\W+/g, "-").toLowerCase()}-error`;
  const limitId = `${ariaLabel.replace(/\W+/g, "-").toLowerCase()}-limit`;
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: value,
    extensions: createEditorExtensions(headings, maxLength, () => setLimitReached(true)),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "aria-invalid": error ? "true" : "false",
        "aria-describedby": error ? errorId : limitReached ? limitId : "",
        class: "min-h-32 max-w-[68ch] p-3 text-question focus:outline-none",
      },
    },
    onUpdate: ({ editor: current }) => {
      setLimitReached(false);
      onChange(current.getHTML());
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (editor && editor.getHTML() !== value) editor.commands.setContent(value || "<p></p>", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("aria-invalid", error ? "true" : "false");
    if (error) editor.view.dom.setAttribute("aria-describedby", errorId);
    else if (limitReached) editor.view.dom.setAttribute("aria-describedby", limitId);
    else editor.view.dom.removeAttribute("aria-describedby");
  }, [editor, error, errorId, limitId, limitReached]);

  if (!editor) return <div className="min-h-32 border border-line bg-hairline" aria-label={`${ariaLabel} loading`} />;

  const command = (run: () => void) => () => { run(); editor.commands.focus(); };
  return <div className="border border-line bg-surface" lang={language}>
    <div className="flex flex-wrap gap-1 border-b border-hairline p-1" role="toolbar" aria-label={`${ariaLabel} formatting`}>
      <button type="button" className={toolbarButton} aria-label="Bold" title="Bold" disabled={disabled} aria-pressed={editor.isActive("bold")} onClick={command(() => { editor.chain().focus().toggleBold().run(); })}>B</button>
      <button type="button" className={toolbarButton} aria-label="Italic" title="Italic" disabled={disabled} aria-pressed={editor.isActive("italic")} onClick={command(() => { editor.chain().focus().toggleItalic().run(); })}><em>I</em></button>
      <button type="button" className={toolbarButton} aria-label="Underline" title="Underline" disabled={disabled} aria-pressed={editor.isActive("underline")} onClick={command(() => { editor.chain().focus().toggleUnderline().run(); })}><u>U</u></button>
      <button type="button" className={toolbarButton} aria-label="Strike" title="Strike" disabled={disabled} aria-pressed={editor.isActive("strike")} onClick={command(() => { editor.chain().focus().toggleStrike().run(); })}><s>S</s></button>
      {headings ? <>
        <button type="button" className={toolbarButton} aria-label="Heading 2" title="Heading 2" disabled={disabled} aria-pressed={editor.isActive("heading", { level: 2 })} onClick={command(() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); })}>H2</button>
        <button type="button" className={toolbarButton} aria-label="Heading 3" title="Heading 3" disabled={disabled} aria-pressed={editor.isActive("heading", { level: 3 })} onClick={command(() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); })}>H3</button>
      </> : null}
      <button type="button" className={toolbarButton} aria-label="Bullet list" title="Bullet list" disabled={disabled} aria-pressed={editor.isActive("bulletList")} onClick={command(() => { editor.chain().focus().toggleBulletList().run(); })}>•</button>
      <button type="button" className={toolbarButton} aria-label="Numbered list" title="Numbered list" disabled={disabled} aria-pressed={editor.isActive("orderedList")} onClick={command(() => { editor.chain().focus().toggleOrderedList().run(); })}>1.</button>
      <label className="sr-only" htmlFor={`${ariaLabel.replace(/\W+/g, "-").toLowerCase()}-font-size`}>Font size</label>
      <select id={`${ariaLabel.replace(/\W+/g, "-").toLowerCase()}-font-size`} title="Font size" aria-label="Font size" className="min-h-11 border border-line bg-surface px-2" disabled={disabled} value={editor.getAttributes("textStyle").fontSize ?? ""} onChange={(event) => {
        if (event.target.value) editor.chain().focus().setFontSize(event.target.value).run();
        else editor.chain().focus().unsetFontSize().run();
      }}>
        <option value="">Default size</option><option value="16px">16 px</option><option value="18px">18 px</option><option value="20px">20 px</option><option value="24px">24 px</option><option value="28px">28 px</option>
      </select>
    </div>
    <EditorContent editor={editor} />
    {error ? <p id={errorId} className="px-3 py-1 text-sm text-alert" role="alert">{error}</p> : null}
    {limitReached ? <p id={limitId} className="px-3 py-1 text-sm text-alert" role="alert">Maximum {maxLength.toLocaleString()} characters reached. Remove text before adding more.</p> : null}
    <p className="border-t border-hairline px-3 py-1 text-right text-xs text-muted">{value.length} / {maxLength}</p>
  </div>;
}
