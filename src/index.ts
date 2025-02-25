import { getIndentUnit, indentUnit } from '@codemirror/language';
import { EditorState, RangeSetBuilder, type Line } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  DecorationSet,
  EditorView,
  ViewUpdate,
  PluginValue,
} from '@codemirror/view';
import { getCurrentLine, getVisibleLines } from './utils';
import { IndentEntry, IndentationMap } from './map';
import { IndentationMarkerConfiguration, indentationMarkerConfig } from "./config";

// CSS classes:
// - .cm-indent-markers

function indentTheme(colorOptions: IndentationMarkerConfiguration['colors']) {
  const defaultColors = {
    light: '#F0F1F2',
    dark: '#2B3245',
    activeLight: '#E4E5E6',
    activeDark: '#3C445C',
  };

  let colors = defaultColors;
  if (colorOptions) {
    colors = {...defaultColors, ...colorOptions};
  }

  return EditorView.baseTheme({
    '&light': {
      '--indent-marker-bg-color': colors.light,
      '--indent-marker-active-bg-color': colors.activeLight,
    },
    
    '&dark': {
      '--indent-marker-bg-color': colors.dark,
      '--indent-marker-active-bg-color': colors.activeDark,
    },
  
    '.cm-line': {
      position: 'relative',
    },
  
    // this pseudo-element is used to draw the indent markers,
    // while still allowing the line to have its own background.
    '.cm-indent-markers::before': {
      content: '""',
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'var(--indent-markers)',
      pointerEvents: 'none',
      zIndex: '-1',
    },
  });
}

function createGradient(markerCssProperty: string, thickness: number, indentWidth: string, startOffset: number, columns: number) {
  const gradient = `repeating-linear-gradient(to right, var(${markerCssProperty}) 0 ${thickness}px, transparent ${thickness}px ${indentWidth})`
  // Subtract one pixel from the background width to get rid of artifacts of pixel rounding
  return `${gradient} calc(${startOffset} * ${indentWidth} + .5ch)/calc(${indentWidth} * ${columns} - 1px) no-repeat`
}

function makeBackgroundCSS(entry: IndentEntry, indentWidth: string, hideFirstIndent: boolean, thickness: number) {
  const { level, active } = entry;
  if (hideFirstIndent && level === 0) {
    return '';
  }
  const startAt = hideFirstIndent ? 1 : 0;
  const backgrounds = [];

  if (active !== undefined) {
    const markersBeforeActive = active - startAt - 1;
    if (markersBeforeActive > 0) {
      backgrounds.push(
        createGradient('--indent-marker-bg-color', thickness, indentWidth, startAt, markersBeforeActive),
      );
    }
    backgrounds.push(
      createGradient('--indent-marker-active-bg-color', thickness, indentWidth, active - 1, 1),
    );
    if (active !== level) {
      backgrounds.push(
        createGradient('--indent-marker-bg-color', thickness, indentWidth, active, level - active)
      );
    }
  } else {
    backgrounds.push(
      createGradient('--indent-marker-bg-color', thickness, indentWidth, startAt, level - startAt)
    );
  }

  return backgrounds.join(',');
}

class IndentMarkersClass implements PluginValue {
  view: EditorView;
  decorations: DecorationSet = Decoration.none;

  private unitWidth: number;
  private currentLineNumber: number;

  constructor(view: EditorView) {
    this.view = view;
    this.unitWidth = getIndentUnit(view.state);
    this.currentLineNumber = getCurrentLine(view.state).number;
    this.generate(view.state);
  }

  update(update: ViewUpdate) {
    const unitWidth = getIndentUnit(update.state);
    const unitWidthChanged = unitWidth !== this.unitWidth;
    if (unitWidthChanged) {
      this.unitWidth = unitWidth;
    }
    const lineNumber = getCurrentLine(update.state).number;
    const lineNumberChanged = lineNumber !== this.currentLineNumber;
    this.currentLineNumber = lineNumber;
    const activeBlockUpdateRequired = update.state.facet(indentationMarkerConfig).highlightActiveBlock && lineNumberChanged;
    if (
      update.docChanged ||
      update.viewportChanged ||
      unitWidthChanged ||
      activeBlockUpdateRequired
    ) {
      this.generate(update.state);
    }
  }

  private generate(state: EditorState) {
    const builder = new RangeSetBuilder<Decoration>();

    const lines = getVisibleLines(this.view, state);
    const { hideFirstIndent, markerType, thickness } = state.facet(indentationMarkerConfig);
    const map = new IndentationMap(lines, state, this.unitWidth, markerType);

    this.view.requestMeasure({
      read: () => {
        let indentUnitString = this.view.state.facet(indentUnit);
        for (const line of lines) {
          const entry = map.get(line.number);
          if (!entry?.level) {
            continue;
          }
          if (!line.text.startsWith(indentUnitString)) {
            continue;
          }
          const width =
            (this.view.coordsAtPos(line.from + indentUnitString.length)?.left ?? 0) -
            (this.view.coordsAtPos(line.from)?.left ?? 0);
          console.log('width', width);
          const backgrounds = makeBackgroundCSS(entry, `${width}px`, hideFirstIndent, thickness);
          this.addBackground(builder, line, backgrounds);
        }
      },
      write: () => {
        this.decorations = builder.finish();
        // Schedule an update. I'm not sure how to do this properly.
        this.view.focus();
      },
    });
  }

  private addBackground(builder: RangeSetBuilder<Decoration>, line: Line, backgrounds: string) {
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: 'cm-indent-markers',
        attributes: {
          style: `--indent-markers: ${backgrounds}`,
        },
      })
    );
  }
}

export function indentationMarkers(config: IndentationMarkerConfiguration = {}) {
  return [
    indentationMarkerConfig.of(config),
    indentTheme(config.colors),
    ViewPlugin.fromClass(IndentMarkersClass, {
      decorations: (v) => v.decorations,
    }),
  ];
}
