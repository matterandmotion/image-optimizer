import { mount } from 'svelte'
// Inter with the optical-size axis: tighter at large sizes, more open at small ones.
import '@fontsource-variable/inter/opsz.css'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
