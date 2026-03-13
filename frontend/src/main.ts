import './styles/main.css'
import { Terminal } from './components/Terminal'
import WalletConnectService from './services/WalletConnectService'
import { TokenViewer } from './components/TokenViewer'
import { SnapshotTool } from './components/SnapshotTool'
import { AirdropTool } from './components/AirdropTool'
import { ArtGenerator } from './components/ArtGenerator'
import { CreateCollection } from './components/CreateCollection'
import { MintNFTs } from './components/MintNFTs'
import { CreateToken } from './components/CreateToken'
import { UpdateTokenIcon } from './components/UpdateTokenIcon'
import { AddLiquidity } from './components/AddLiquidity'
import { BurnTool } from './components/BurnTool'
import { SwapTool } from './components/SwapTool'
import { StakingTool } from './components/StakingTool'
import { DomainTool } from './components/DomainTool'
import { HelpPage } from './components/HelpPage'

// Initialize the application
const app = document.querySelector<HTMLDivElement>('#app')!

// Render the main terminal menu by default
app.innerHTML = Terminal.render()
Terminal.init()

// Listen for navigation events
window.addEventListener('navigate-to-tool', ((event: CustomEvent) => {
  const toolId = event.detail.toolId

  // Security: verify SLIME ownership server-side before rendering any tool.
  // This blocks console-based dispatch attacks (e.g. window.dispatchEvent(...)).
  // 'home', 'menu', and 'help' are safe routes that do not require the gate.
  const publicRoutes = ['home', 'menu', 'help']
  if (!publicRoutes.includes(toolId) && WalletConnectService.getState().hasSlime !== true) {
    console.warn('Navigation blocked: SLIME NFT not verified for tool:', toolId)
    app.innerHTML = Terminal.render()
    Terminal.init()
    return
  }

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
    case 'art-generator':
      console.log('Rendering ArtGenerator')
      app.innerHTML = ArtGenerator.render()
      ArtGenerator.init()
      console.log('ArtGenerator initialized')
      break
    case 'create-collection':
      console.log('Rendering CreateCollection')
      app.innerHTML = CreateCollection.render()
      CreateCollection.init()
      console.log('CreateCollection initialized')
      break
    case 'mint-nfts':
      console.log('Rendering MintNFTs')
      app.innerHTML = MintNFTs.render()
      MintNFTs.init()
      console.log('MintNFTs initialized')
      break
    case 'create-token':
      console.log('Rendering CreateToken')
      app.innerHTML = CreateToken.render()
      CreateToken.init()
      console.log('CreateToken initialized')
      break
    case 'update-token-icon':
      console.log('Rendering UpdateTokenIcon')
      app.innerHTML = UpdateTokenIcon.render()
      UpdateTokenIcon.init()
      console.log('UpdateTokenIcon initialized')
      break
    case 'add-liquidity':
      console.log('Rendering AddLiquidity')
      app.innerHTML = AddLiquidity.render()
      AddLiquidity.init()
      console.log('AddLiquidity initialized')
      break
    case 'burn':
      console.log('Rendering BurnTool')
      app.innerHTML = BurnTool.render()
      BurnTool.init()
      console.log('BurnTool initialized')
      break
    case 'swap':
      console.log('Rendering SwapTool')
      app.innerHTML = SwapTool.render()
      SwapTool.init()
      console.log('SwapTool initialized')
      break
    case 'staking':
      console.log('Rendering StakingTool')
      app.innerHTML = StakingTool.render()
      StakingTool.init()
      console.log('StakingTool initialized')
      break
    case 'domain-registration':
      console.log('Rendering DomainTool')
      app.innerHTML = DomainTool.render()
      DomainTool.init()
      console.log('DomainTool initialized')
      break
    case 'help':
      app.innerHTML = HelpPage.render()
      HelpPage.init()
      break
    case 'home':
    case 'menu':
      console.log('Returning to menu')

      // Reset all tool states to clear any cached/persisted data
      // This ensures tools start fresh when navigated to again
      ArtGenerator.resetState()
      CreateCollection.resetForm()
      MintNFTs.resetState()
      CreateToken.resetForm()
      UpdateTokenIcon.resetForm()
      AddLiquidity.resetForm()
      BurnTool.resetForm()
      SwapTool.resetState()
      StakingTool.resetState()
      DomainTool.resetForm()

      console.log('App element:', app)
      const rendered = Terminal.render()
      console.log('Rendered HTML length:', rendered.length)
      app.innerHTML = rendered
      console.log('App innerHTML set, length:', app.innerHTML.length)
      Terminal.init()
      console.log('Terminal.init() called')
      break
    // Add other tools here as they're implemented
    default:
      console.log('Unknown tool, returning to menu')
      app.innerHTML = Terminal.render()
      Terminal.init()
  }
}) as EventListener)

