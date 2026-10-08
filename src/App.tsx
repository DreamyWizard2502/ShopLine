import { useEffect, useMemo, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useNavigate, Link } from 'react-router-dom'
import { StoreProvider, useStore } from './lib/store'
import { Icon } from './components/ui'
import WorkInProgress from './pages/WorkInProgress'
import NewRO from './pages/NewRO'
import RODetail from './pages/RODetail'
import PrintRO from './pages/PrintRO'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Parts from './pages/Parts'
import SettingsPage from './pages/Settings'
import Wholegoods from './pages/Wholegoods'
import ImportPage from './pages/Import'
import MergeCustomers from './pages/MergeCustomers'
import ArOverview, { ArAccount } from './pages/AR'
import { allAccounts } from './lib/ar'
import { OverrideHost, requestOverride } from './components/override'

// Shown only on the hosted demo (GitHub Pages) so first-time visitors know what they're looking at.
const IS_DEMO = typeof location !== 'undefined' && location.hostname.endsWith('github.io')
function DemoBanner() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('shopline.demoNote') !== 'off' } catch { return true } })
  if (!IS_DEMO || !open) return null
  return (
    <div className="demo-banner no-print">
      <span><b>Live demo.</b> Everything here is sample data, and anything you change stays in your own browser. Master override PIN is <span className="mono">0000</span>. Start over anytime from Settings → Admin tools → Reset to demo data.</span>
      <button className="btn sm" onClick={() => { setOpen(false); try { localStorage.setItem('shopline.demoNote', 'off') } catch { /* ignore */ } }}>Got it</button>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const { db, setCurrentUser, override, disableOverride } = useStore()
  const nav = useNavigate()
  const open = db.ros.filter((r) => r.status !== 'closed').length
  const wgCount = db.wholegoods.filter((w) => w.status === 'in_stock' || w.status === 'demo').length
  const pastDue = useMemo(() => [...allAccounts(db).values()].filter((a) => a.pastDue > 0).length, [db])

  // Global keyboard shortcuts — counter staff live on the keyboard.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); nav('/ro/new') }
      if (e.key === '/') {
        e.preventDefault()
        nav('/')
        setTimeout(() => document.getElementById('wip-search')?.focus(), 0)
      }
      if (e.key === 'd' || e.key === 'D') { e.preventDefault(); nav('/dashboard') }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [nav])

  return (
    <div className="shell">
      <aside className="side no-print">
        <Link to="/" className="brand">
          <span className="brand-mark">SL</span>
          <span><span className="brand-name">ShopLine</span><span className="brand-sub">Dealer System</span></span>
        </Link>
        <NavLink to="/" end className="nav-link">{Icon.wrench} Work in Progress <span className="count">{open}</span></NavLink>
        <NavLink to="/ro/new" className="nav-link">{Icon.plus} New Repair Order</NavLink>
        <NavLink to="/dashboard" className="nav-link">{Icon.chart} Shop Dashboard</NavLink>
        <div className="nav-section">Inventory</div>
        <NavLink to="/wholegoods" className="nav-link">{Icon.mower} Wholegoods <span className="count">{wgCount}</span></NavLink>
        <NavLink to="/parts" className="nav-link">{Icon.box} Parts Inventory</NavLink>
        <NavLink to="/import" className="nav-link">{Icon.upload} Import Data</NavLink>
        <div className="nav-section">Records</div>
        <NavLink to="/customers" className="nav-link">{Icon.users} Customers & Units</NavLink>
        <NavLink to="/ar" className="nav-link">{Icon.ledger} Accounts Receivable {pastDue > 0 && <span className="count" title="Accounts past due">{pastDue}</span>}</NavLink>
        <NavLink to="/settings" className="nav-link">{Icon.gear} Settings</NavLink>
        <div className="side-foot">
          <div>Working as</div>
          <select value={db.currentUserId} onChange={(e) => setCurrentUser(e.target.value)} aria-label="Current user">
            {db.staff.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {s.role}</option>
            ))}
          </select>
          <button className={`override-btn ${override ? 'on' : ''}`} onClick={() => (override ? disableOverride() : requestOverride())}>
            {override ? '🔓 Override ON · turn off' : '🔒 Master override'}
          </button>
          <div style={{ marginTop: 12, lineHeight: 1.9 }}>
            <span className="kbd">N</span> new RO &nbsp; <span className="kbd">/</span> search<br />
            <span className="kbd">D</span> dashboard
          </div>
        </div>
      </aside>
      <main className="main"><DemoBanner /><OverrideHost />{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routes>
          <Route path="/ro/:id/print/:kind" element={<PrintRO />} />
          <Route path="*" element={
            <Shell>
              <Routes>
                <Route path="/" element={<WorkInProgress />} />
                <Route path="/ro/new" element={<NewRO />} />
                <Route path="/ro/:id" element={<RODetail />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/customers/merge" element={<MergeCustomers />} />
                <Route path="/customers/:id" element={<CustomerDetail />} />
                <Route path="/ar" element={<ArOverview />} />
                <Route path="/ar/:id" element={<ArAccount />} />
                <Route path="/parts" element={<Parts />} />
                <Route path="/wholegoods" element={<Wholegoods />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<div className="page"><h1>Not found</h1><Link to="/">Back to Work in Progress</Link></div>} />
              </Routes>
            </Shell>
          } />
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}
