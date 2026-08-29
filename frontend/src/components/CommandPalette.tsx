import { CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface WorkspaceCommand {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  commands: WorkspaceCommand[];
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ commands, open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.group}`.toLowerCase().includes(normalized),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) =>
      filtered.length === 0 ? 0 : Math.min(Math.max(current, 0), filtered.length - 1),
    );
  }, [filtered.length]);

  if (!open) return null;

  const runCommand = (command: WorkspaceCommand) => {
    command.run();
    onClose();
  };

  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="工作台命令"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (filtered.length > 0) setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                if (filtered.length > 0) setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                runCommand(filtered[activeIndex]);
              }
            }}
            placeholder="搜索事件、视图和操作"
            aria-label="搜索工作台命令"
          />
          <button type="button" className="command-close" onClick={onClose} title="关闭命令面板" aria-label="关闭命令面板">
            <X size={17} />
          </button>
        </div>

        <div className="command-results" role="listbox" aria-label="可用命令">
          {filtered.map((command, index) => (
            <button
              type="button"
              className={index === activeIndex ? "command-item active" : "command-item"}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand(command)}
              role="option"
              aria-selected={index === activeIndex}
              key={command.id}
            >
              <span className="command-icon">{command.icon}</span>
              <span><strong>{command.label}</strong><small>{command.group}</small></span>
              <CornerDownLeft size={14} />
            </button>
          ))}
          {filtered.length === 0 && <div className="command-empty">没有匹配的命令</div>}
        </div>
      </section>
    </div>
  );
}
