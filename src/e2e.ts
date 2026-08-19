import '@wdio/tauri-plugin'

// This module is injected only by the e2e Vite build. Keeping the marker on
// the document makes startup readiness observable without racing WebView2 or
// relying on Windows foreground focus.
document.documentElement.dataset.e2eRuntime = 'ready'
