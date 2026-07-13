import { EditorView, WidgetType } from "@codemirror/view";
import { translateCurrent } from "../../../shared/i18n/translate";
import { renderMathText } from "../markdown/mathText";

export class ListMarkerWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-typora-list-marker";
    marker.textContent = this.label;
    return marker;
  }
}

export class TaskListMarkerWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly checkboxCharFrom: number,
  ) {
    super();
  }

  eq(other: TaskListMarkerWidget): boolean {
    return (
      other.checked === this.checked &&
      other.checkboxCharFrom === this.checkboxCharFrom
    );
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = this.checked
      ? "cm-typora-task-marker cm-typora-task-marker-checked"
      : "cm-typora-task-marker";
    marker.textContent = this.checked ? "✓" : "";
    marker.setAttribute(
      "aria-label",
      translateCurrent(this.checked ? "editor.taskChecked" : "editor.taskUnchecked"),
    );
    marker.setAttribute("role", "checkbox");
    marker.setAttribute("aria-checked", String(this.checked));

    const toggle = () => {
      const view = EditorView.findFromDOM(marker);
      if (!view) {
        return;
      }
      const scrollTop = view.scrollDOM.scrollTop;
      const scrollLeft = view.scrollDOM.scrollLeft;
      view.dispatch({
        changes: {
          from: this.checkboxCharFrom,
          to: this.checkboxCharFrom + 1,
          insert: this.checked ? " " : "x",
        },
        scrollIntoView: false,
        userEvent: "input.taskToggle",
      });
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
      window.requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      });
    };

    marker.addEventListener("pointerdown", stopMarkerEvent);
    marker.addEventListener("mousedown", stopMarkerEvent);
    marker.addEventListener("click", (event) => {
      stopMarkerEvent(event);
      toggle();
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        stopMarkerEvent(event);
        toggle();
      }
    });
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class InlineMathWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  eq(other: InlineMathWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-typora-inline-math";
    span.textContent = renderMathText(this.source);
    return span;
  }
}

function stopMarkerEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
