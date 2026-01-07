import './styles/main.css'
import { Terminal } from './components/Terminal'
import { TokenViewer } from './components/TokenViewer'
import { SnapshotTool } from './components/SnapshotTool'
import { AirdropTool } from './components/AirdropTool'

// Initialize the application
const app = document.querySelector<HTMLDivElement>('#app')!

// Render the main terminal menu by default
app.innerHTML = Terminal.render()
Terminal.init()

// Listen for navigation events
window.addEventListener('navigate-to-tool', ((event: CustomEvent) => {
  const toolId = event.detail.toolId
  console.log('Navigating to tool:', toolId)

  switch (toolId) {
    case 'token-viewer':
      console.log('Rendering TokenViewer')
      app.innerHTML = TokenViewer.render()
      TokenViewer.init()
      console.log('TokenViewer initialized')
      break
    case 'snapshot':
      console.log('Rendering SnapshotTool')
      app.innerHTML = SnapshotTool.render()
      SnapshotTool.init()
      console.log('SnapshotTool initialized')
      break
    case 'airdrop':
      console.log('Rendering AirdropTool')
      app.innerHTML = AirdropTool.render()
      AirdropTool.init()
      console.log('AirdropTool initialized')
      break
    // Add other tools here as they're implemented
    default:
      console.log('Unknown tool, returning to menu')
      app.innerHTML = Terminal.render()
      Terminal.init()
  }
}) as EventListener)

