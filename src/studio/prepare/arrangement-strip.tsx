import { keepFocusInList } from "@/lib/keep-focus"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import { PlusIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { sectionShort } from "@/lib/lyrics"
import { appendStep, moveStep, removeStep, type SectionForm, type Step } from "@/lib/song-form"

/**
 * The order a song is sung in, as a strip of chips. Drag a chip to move it,
 * or focus it and use ← → to move, Delete to remove. The palette below
 * appends a section with "+". No section is ever changed here.
 */
export function ArrangementStrip({
  steps,
  sections,
  onChange,
}: {
  steps: Step[]
  sections: SectionForm[]
  onChange: (steps: Step[]) => void
}) {
  const byId = new Map(sections.map((s) => [s.id, s]))
  return (
    <div className="flex flex-col gap-2">
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return
          const { source } = event.operation
          if (isSortable(source) && source.initialIndex !== source.index) onChange(moveStep(steps, source.initialIndex, source.index))
        }}
      >
        <ol className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border p-2" aria-label="Arrangement order">
          {steps.length === 0 && <li className="px-1 text-xs text-muted-foreground">Nothing yet. Add sections from the list below.</li>}
          {steps.map((step, index) => {
            const section = byId.get(step.sectionId)
            return (
              <Chip
                key={step.uid}
                step={step}
                index={index}
                label={section ? sectionShort(section.kind, section.label) : "?"}
                title={section?.label ?? "Missing section"}
                onMove={(to) => onChange(moveStep(steps, index, to))}
                onRemove={() => onChange(removeStep(steps, step.uid))}
              />
            )
          })}
        </ol>
      </DragDropProvider>
      <ul className="flex flex-wrap gap-1.5" aria-label="Sections to add">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onChange(appendStep(steps, s.id))}
              className="flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
              title={`Add ${s.label} to the end`}
            >
              <PlusIcon className="size-3" /> {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chip({
  step,
  index,
  label,
  title,
  onMove,
  onRemove,
}: {
  step: Step
  index: number
  label: string
  title: string
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const { ref, isDragging } = useSortable({ id: step.uid, index })
  return (
    <li ref={ref} className={cn("flex items-stretch rounded-md border border-border bg-card text-xs font-semibold", isDragging && "opacity-60 shadow-lg")}>
      <button
        type="button"
        title={`${title}. Drag or use arrow keys to move, Delete to remove.`}
        aria-label={`${title}, position ${index + 1}`}
        className="cursor-grab px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-l-md active:cursor-grabbing"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); onMove(index - 1) }
          if (e.key === "ArrowRight") { e.preventDefault(); onMove(index + 1) }
          if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); keepFocusInList(e.currentTarget, 'button[aria-label*=", position "]'); onRemove() }
        }}
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={`Remove ${title} from position ${index + 1}`}
        onClick={onRemove}
        className="flex items-center border-l border-border px-1.5 text-muted-foreground hover:text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-r-md"
      >
        <XIcon className="size-3" />
      </button>
    </li>
  )
}
