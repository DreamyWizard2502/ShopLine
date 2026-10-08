// Fictional sample data so the app is useful the moment it opens.
// All names, phone numbers and serials are made up.
import type {
  Customer, DB, LaborLine, Line, Part, PartLine, RepairOrder, ROStatus, Settings, Staff,
  TimelineEvent, Unit, UnitType, FeeLine, Approval, Wholegood, WholegoodStatus,
} from './types'
import { STATUS_LABEL, STATUS_ORDER, round2 } from './calc'
import { ensureCashCustomer } from './customerSearch'

export const DB_VERSION = 3

// Small deterministic PRNG so every reset gives the same shop.
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const defaultSettings: Settings = {
  shopName: 'ShopLine Demo Outdoor Power',
  shopAddress: '1200 Example Rd, Springfield, OK 73000',
  shopPhone: '(405) 555-0100',
  shopFax: '',
  invoiceTerms: 'Thank you for your business! Receipt required to verify work done. Repairs left more than 30 days after completion are subject to a $1.00/day storage fee. We guarantee our shop work for 30 days. If it is not right, we will make it right.',
  laborRate: 95,
  taxRate: 0.0875,
  taxLabor: false,
  shopSuppliesPct: 5,
  staleDays: 21,
  partsWaitDays: 10,
  agedUnitDays: 180,
  overridePin: '0000',
}

export const defaultLines: Line[] = [
  { code: 'SCAG', name: 'Scag', color: '#c8102e', carriesWholegoods: true },
  { code: 'EXMARK', name: 'Exmark', color: '#b5121b', carriesWholegoods: true },
  { code: 'STIHL', name: 'Stihl', color: '#f37a1f', carriesWholegoods: true },
  { code: 'ECHO', name: 'Echo', color: '#e35205', carriesWholegoods: true },
  { code: 'SHINDAIWA', name: 'Shindaiwa', color: '#d4a017', carriesWholegoods: true },
  { code: 'TORO', name: 'Toro', color: '#cc0000', carriesWholegoods: true },
  { code: 'OTHER', name: 'All Makes / Used', color: '#5f6670', carriesWholegoods: true },
]

const VENDOR_LINE: Record<string, string> = {
  Stihl: 'STIHL', Echo: 'ECHO', Exmark: 'EXMARK', Scag: 'SCAG', Toro: 'TORO', Shindaiwa: 'SHINDAIWA',
}

// Extra line-specific catalog so every tab has depth. Part numbers are made up.
const LINE_PARTS: Record<string, [string, number][]> = {
  SCAG: [['Blade, 61" Advantage deck', 22], ['Belt, deck drive 61"', 48], ['Belt, pump drive', 31], ['Spindle assy, cast', 96], ['Idler arm assy', 54], ['Caster wheel assy 13x6.5', 68], ['Tire, drive 24x12-12', 112], ['Hydro filter', 26], ['Seat switch', 19], ['PTO clutch, electric', 289], ['Anti-scalp roller', 14], ['Grease fitting kit', 6], ['Deflector chute', 41], ['Control handle grip', 12], ['Deck wheel bearing', 9]],
  EXMARK: [['Blade, 60" UltraCut high-lift', 21], ['Belt, deck 60" UltraCut', 52], ['Belt, pump drive', 33], ['Spindle assy', 92], ['Idler pulley, flat', 24], ['Hydro filter kit', 38], ['Caster wheel 13x5', 61], ['Tire, rear 24x12-12', 118], ['PTO switch', 27], ['Seat, high-back', 245], ['Mulch kit baffle', 64], ['Fuel cap', 11], ['Battery hold-down', 8], ['Deck lift pedal grip', 7], ['Pump idler spring', 6]],
  STIHL: [['Air filter, HD2', 18], ['Spark plug, Bosch WSR6F', 4], ['Chain, 18" 26RS 74DL', 29], ['Bar, 18" Rollomatic E', 49], ['Sprocket rim .325', 11], ['Fuel filter pickup', 8], ['Fuel line set', 12], ['Starter rope 3.0mm', 3], ['Rewind starter assy', 44], ['Carburetor, Zama C1Q', 58], ['Trimmer head, AutoCut 25-2', 26], ['Trimmer line .095 3 lb', 32], ['Blower tube, flex', 22], ['Clutch drum', 34], ['Ignition module', 61], ['HP Ultra 2-cycle oil 6-pk', 21], ['MotoMix 32 oz', 7]],
  ECHO: [['Air filter, SRM', 7], ['Spark plug', 4], ['Fuel line & filter kit', 9], ['Carburetor, Walbro WT', 42], ['Speed-Feed 400 head', 28], ['Trimmer line .095 3 lb', 29], ['Chain, 20" 72LGX', 31], ['Bar, 20" Pro', 46], ['Rewind starter assy', 38], ['Blower tube kit PB', 34], ['Throttle cable', 18], ['Ignition coil', 52], ['Recoil rope', 3], ['Red Armor 2-cycle oil 6-pk', 19], ['Edger blade 8"', 9]],
  SHINDAIWA: [['Air filter, T-series', 8], ['Spark plug', 4], ['Fuel line & filter kit', 10], ['Carburetor', 44], ['Trimmer head, Speed-Feed', 27], ['Blower intake screen', 6], ['Recoil starter assy', 39], ['Ignition coil', 55], ['Gearcase, trimmer', 64], ['Driveshaft, flex', 47], ['Edger blade', 9], ['Throttle trigger', 7]],
  TORO: [['Blade, 22" Recycler', 19], ['Blade, 30" TimeMaster', 28], ['Belt, drive Personal Pace', 24], ['Belt, 50" TimeCutter deck', 39], ['Air filter, Briggs 595853', 9], ['Spark plug', 4], ['Wheel, rear 8"', 18], ['Drive cable', 22], ['Recoil starter assy', 36], ['Carburetor, OEM', 54], ['Bagger, 22" Recycler', 49], ['Spindle assy, TimeCutter', 74], ['Hydro oil 1 qt', 11]],
}

const FIRST = ['Marcus', 'Dana', 'Luis', 'Tara', 'Wes', 'Kendra', 'Hector', 'Brooke', 'Caleb', 'Renee',
  'Javier', 'Molly', 'Travis', 'Ana', 'Gordon', 'Leah', 'Rafael', 'Shelby', 'Dwight', 'Carmen',
  'Nolan', 'Tasha', 'Owen', 'Priya', 'Clint', 'Yvonne']
const LAST = ['Hollis', 'Pruitt', 'Vance', 'Ochoa', 'Brantley', 'Keel', 'Medina', 'Sutter', 'Dobbs',
  'Farrow', 'Lindqvist', 'Ruiz', 'Talbot', 'Mercer', 'Quinlan', 'Barlow', 'Cortez', 'Haskins',
  'Pelham', 'Whitlock', 'Garza', 'Stroud']
const BIZ = ['Red Dirt Lawn Co.', 'Prairie Edge Landscaping', 'Cimarron Turf Pros', 'Sooner Cut Lawn Care',
  'Twin Oaks Tree Service', 'Redbud Grounds Maintenance', 'Canadian River Mowing', 'Big Sky Property Care',
  'Crosstimbers Landscape', 'Wheatland Outdoor Services']

// Business → Infinity-style category (anything not listed is Landscape).
const BIZ_CATEGORY: Record<string, string> = {
  'Big Sky Property Care': 'Commercial', 'Canadian River Mowing': 'Government', 'Wheatland Outdoor Services': 'Farm',
}
const TOWNS: [string, string][] = [['Mustang', '73064'], ['Mustang', '73064'], ['Yukon', '73099'], ['Tuttle', '73089'], ['El Reno', '73036'], ['Oklahoma City', '73179']]
const STREETS = ['Elder Ln', 'S Mustang Rd', 'W Forest Dr', 'Horizon Blvd', 'N Sara Rd', 'Czech Hall Rd', 'Cemetery Rd', 'W Main St', 'Ranchwood Blvd', 'SW 74th St']

const STAFF: Staff[] = [
  { id: 's-ana', name: 'Ana R.', role: 'counter', active: true },
  { id: 's-ben', name: 'Ben T.', role: 'manager', active: true },
  { id: 't-cody', name: 'Cody M.', role: 'tech', active: true },
  { id: 't-dre', name: 'Dre W.', role: 'tech', active: true },
  { id: 't-jess', name: 'Jess P.', role: 'tech', active: true },
]
const TECHS = STAFF.filter((s) => s.role === 'tech')

const PARTS_RAW: [string, string, string, number, number][] = [
  // partNo, description, vendor, cost, onHand
  ['SPK-RJ19LM', 'Spark plug RJ19LM', 'Champion', 2.4, 40],
  ['SPK-BPR6ES', 'Spark plug BPR6ES', 'NGK', 2.6, 35],
  ['SPK-CMR6H', 'Spark plug CMR6H (handheld)', 'NGK', 3.9, 22],
  ['AF-491588S', 'Air filter, 3.5–4 HP vertical', 'Briggs', 5.8, 18],
  ['AF-PRE-ZT', 'Air filter + pre-cleaner, ZT twin', 'Kawasaki', 21.5, 6],
  ['AF-HH-FELT', 'Air filter, handheld felt', 'Stihl', 6.2, 14],
  ['OF-492932', 'Oil filter, V-twin', 'Briggs', 6.9, 20],
  ['OF-49065', 'Oil filter, FR/FX series', 'Kawasaki', 8.1, 12],
  ['OIL-SAE30-QT', 'Oil SAE30, 1 qt', 'Shop stock', 4.1, 60],
  ['OIL-10W30-QT', 'Oil 10W-30, 1 qt', 'Shop stock', 4.5, 48],
  ['FF-INLINE', 'Fuel filter, inline 1/4"', 'Rotary', 1.9, 30],
  ['FL-1/4-FT', 'Fuel line 1/4" ID, per ft', 'Rotary', 0.9, 100],
  ['FL-HH-KIT', 'Fuel line + filter kit, handheld', 'Echo', 7.5, 10],
  ['CARB-PUSH-OEM', 'Carburetor assy, push mower OEM', 'Briggs', 48, 3],
  ['CARB-HH-ZAMA', 'Carburetor, handheld Zama', 'Zama', 39, 2],
  ['CARB-KIT-ZT', 'Carb rebuild kit, V-twin', 'Kohler', 22, 4],
  ['PRIMER-BULB', 'Primer bulb', 'Rotary', 1.2, 25],
  ['BLD-21-HL', 'Blade 21" high-lift', 'Rotary', 9.8, 16],
  ['BLD-60-SET', 'Blade set 60" deck (3)', 'Rotary', 52, 5],
  ['BLD-52-SET', 'Blade set 52" deck (3)', 'Rotary', 46, 4],
  ['BELT-DECK-60', 'Deck belt 60"', 'Exmark', 41, 3],
  ['BELT-DRV-SP', 'Drive belt, self-propelled', 'Toro', 14.5, 6],
  ['BELT-PUMP-ZT', 'Hydro pump belt, ZT', 'Scag', 29, 2],
  ['SPDL-ASSY', 'Spindle assembly', 'Rotary', 58, 4],
  ['IDLER-PULLEY', 'Idler pulley w/ bearing', 'Rotary', 18.5, 8],
  ['BATT-U1', 'Battery U1 12V', 'Shop stock', 42, 6],
  ['SOL-STARTER', 'Starter solenoid', 'Rotary', 13, 5],
  ['STARTER-ZT', 'Electric starter, V-twin', 'Kawasaki', 96, 1],
  ['RECOIL-ASSY', 'Recoil starter assembly', 'Briggs', 24, 4],
  ['RECOIL-ROPE', 'Starter rope #4, per ft', 'Rotary', 0.35, 200],
  ['CHAIN-18', 'Saw chain 18" .325', 'Stihl', 19, 10],
  ['CHAIN-20', 'Saw chain 20" 3/8', 'Husqvarna', 23, 8],
  ['BAR-18', 'Guide bar 18"', 'Stihl', 38, 3],
  ['TRIM-HEAD', 'Trimmer head, bump feed', 'Echo', 16.5, 7],
  ['TRIM-LINE-095', 'Trimmer line .095, 1 lb', 'Shop stock', 7, 15],
  ['TIRE-ZT-FRONT', 'Front caster tire 11x4-5', 'Rotary', 31, 4],
  ['TIRE-ZT-REAR', 'Rear drive tire 22x10-12', 'Rotary', 88, 2],
  ['PW-PUMP', 'Pressure washer pump 3100 PSI', 'AR', 135, 1],
  ['PW-UNLOADER', 'Unloader valve', 'AR', 34, 2],
  ['GEN-AVR', 'Generator AVR (voltage regulator)', 'Generac', 72, 1],
  ['IGN-COIL-PUSH', 'Ignition coil, push mower', 'Briggs', 36, 3],
  ['IGN-COIL-HH', 'Ignition module, handheld', 'Stihl', 44, 2],
  ['FUEL-TREAT', 'Fuel stabilizer 8 oz', 'Shop stock', 4.2, 24],
  ['HYD-OIL-20W50', 'Hydro oil 20W-50, 1 qt', 'Hydro-Gear', 9, 18],
]

type JobTemplate = {
  types: UnitType[]
  complaint: string
  cause: string
  correction: string
  labor: [string, number][]
  parts: [string, number][]
}

const JOBS: JobTemplate[] = [
  { types: ['Push Mower', 'Self-Propelled Mower'], complaint: 'Will not start, sat all winter.',
    cause: 'Varnished fuel in carburetor, main jet plugged.', correction: 'Cleaned carburetor, replaced fuel line and plug, fresh fuel and stabilizer.',
    labor: [['Diagnose no-start', 0.3], ['Clean carburetor', 0.8]], parts: [['SPK-RJ19LM', 1], ['FL-1/4-FT', 2], ['FUEL-TREAT', 1]] },
  { types: ['Push Mower', 'Self-Propelled Mower'], complaint: 'Annual tune-up and blade sharpen.',
    cause: 'Scheduled maintenance.', correction: 'Changed oil, air filter, spark plug; sharpened and balanced blade.',
    labor: [['Tune-up, push mower', 0.7], ['Sharpen/balance blade', 0.3]], parts: [['SPK-RJ19LM', 1], ['AF-491588S', 1], ['OIL-SAE30-QT', 1]] },
  { types: ['Self-Propelled Mower'], complaint: 'Won\'t pull itself, wheels don\'t drive.',
    cause: 'Drive belt worn and glazed.', correction: 'Replaced drive belt, adjusted drive cable.',
    labor: [['Replace drive belt', 0.8]], parts: [['BELT-DRV-SP', 1]] },
  { types: ['Push Mower'], complaint: 'Pull rope broke.',
    cause: 'Starter rope frayed through.', correction: 'Restrung recoil with new rope.',
    labor: [['Restring recoil', 0.4]], parts: [['RECOIL-ROPE', 6]] },
  { types: ['Zero-Turn Mower', 'Riding Mower'], complaint: 'Deck squealing, cut is uneven on left side.',
    cause: 'Left spindle bearing failed, idler pulley noisy.', correction: 'Replaced left spindle and idler pulley, new deck belt, leveled deck.',
    labor: [['Replace spindle', 1.0], ['Replace idler pulley', 0.4], ['Level deck', 0.5]], parts: [['SPDL-ASSY', 1], ['IDLER-PULLEY', 1], ['BELT-DECK-60', 1]] },
  { types: ['Zero-Turn Mower'], complaint: 'Full service before season — oil, filters, blades, hydro.',
    cause: 'Scheduled maintenance.', correction: 'Engine oil/filter, air filter, plugs, blades, hydro oil top-off, greased fittings.',
    labor: [['Full service, zero-turn', 2.0]], parts: [['OF-49065', 1], ['OIL-10W30-QT', 2], ['AF-PRE-ZT', 1], ['SPK-BPR6ES', 2], ['BLD-60-SET', 1], ['HYD-OIL-20W50', 2]] },
  { types: ['Zero-Turn Mower', 'Riding Mower'], complaint: 'Clicks but won\'t crank.',
    cause: 'Battery would not hold load test; solenoid contacts burnt.', correction: 'Replaced battery and starter solenoid, cleaned terminals.',
    labor: [['Diagnose no-crank', 0.5], ['Replace solenoid', 0.4]], parts: [['BATT-U1', 1], ['SOL-STARTER', 1]] },
  { types: ['Zero-Turn Mower'], complaint: 'Starter grinds, sometimes won\'t engage.',
    cause: 'Starter drive worn.', correction: 'Replaced electric starter.',
    labor: [['Replace starter', 1.2]], parts: [['STARTER-ZT', 1]] },
  { types: ['Zero-Turn Mower'], complaint: 'Right side weak going uphill.',
    cause: 'Pump belt stretched and slipping.', correction: 'Replaced hydro pump belt and checked hydro oil.',
    labor: [['Replace pump belt', 1.0]], parts: [['BELT-PUMP-ZT', 1], ['HYD-OIL-20W50', 1]] },
  { types: ['Chainsaw'], complaint: 'Bogs down under load, chain dull.',
    cause: 'Clogged air filter and dull/stretched chain.', correction: 'New chain, air filter, plug; adjusted carb.',
    labor: [['Saw service', 0.8]], parts: [['CHAIN-18', 1], ['AF-HH-FELT', 1], ['SPK-CMR6H', 1]] },
  { types: ['Chainsaw', 'String Trimmer', 'Backpack Blower', 'Handheld Blower', 'Hedge Trimmer', 'Edger'], complaint: 'Won\'t start, fuel leaking from tank area.',
    cause: 'Fuel line cracked, carburetor diaphragm hardened.', correction: 'Replaced fuel line/filter kit and carburetor.',
    labor: [['Replace fuel lines', 0.6], ['Replace carburetor', 0.5]], parts: [['FL-HH-KIT', 1], ['CARB-HH-ZAMA', 1], ['PRIMER-BULB', 1]] },
  { types: ['String Trimmer'], complaint: 'Head won\'t bump feed.',
    cause: 'Head spring and eyelets worn.', correction: 'Installed new bump-feed head and line.',
    labor: [['Replace trimmer head', 0.3]], parts: [['TRIM-HEAD', 1], ['TRIM-LINE-095', 1]] },
  { types: ['Pressure Washer'], complaint: 'Pulses, low pressure.',
    cause: 'Unloader valve sticking, pump seals leaking.', correction: 'Replaced pump assembly and unloader.',
    labor: [['Diagnose pressure loss', 0.5], ['Replace pump', 1.0]], parts: [['PW-PUMP', 1], ['PW-UNLOADER', 1]] },
  { types: ['Generator'], complaint: 'Runs but no power at outlets.',
    cause: 'Failed AVR.', correction: 'Replaced AVR, load tested 30 min.',
    labor: [['Diagnose no output', 0.8], ['Replace AVR, load test', 0.8]], parts: [['GEN-AVR', 1]] },
  { types: ['Tiller', 'Edger'], complaint: 'Hard to start, smokes.',
    cause: 'Overfilled crankcase, fouled plug.', correction: 'Changed oil, new plug and air filter.',
    labor: [['Service small engine', 0.7]], parts: [['OIL-SAE30-QT', 1], ['SPK-RJ19LM', 1], ['AF-491588S', 1]] },
]

const UNIT_MODELS: Record<UnitType, [string, string][]> = {
  'Push Mower': [['Toro', 'Recycler 21"'], ['Craftsman', 'M105 21"'], ['Honda', 'HRN216'], ['Troy-Bilt', 'TB110']],
  'Self-Propelled Mower': [['Toro', 'TimeMaster 30"'], ['Honda', 'HRX217'], ['Husqvarna', 'HU800AWD']],
  'Zero-Turn Mower': [['Exmark', 'Lazer Z 60"'], ['Scag', 'Turf Tiger II 61"'], ['Bad Boy', 'Maverick 54"'], ['Toro', 'TimeCutter 50"'], ['Ferris', 'IS 600Z 52"']],
  'Riding Mower': [['Cub Cadet', 'XT1 42"'], ['John Deere', 'S120 42"'], ['Husqvarna', 'YTH24V48']],
  Chainsaw: [['Stihl', 'MS 271'], ['Stihl', 'MS 250'], ['Husqvarna', '455 Rancher'], ['Echo', 'CS-590']],
  'String Trimmer': [['Stihl', 'FS 91 R'], ['Echo', 'SRM-225'], ['Husqvarna', '525L']],
  'Backpack Blower': [['Stihl', 'BR 600'], ['Echo', 'PB-580T'], ['Husqvarna', '570BTS']],
  'Handheld Blower': [['Stihl', 'BG 56'], ['Echo', 'PB-250']],
  'Hedge Trimmer': [['Stihl', 'HS 82 R'], ['Echo', 'HC-2020']],
  Edger: [['Echo', 'PE-225'], ['Stihl', 'FC 91']],
  'Pressure Washer': [['Simpson', 'MegaShot 3100'], ['Generac', 'SpeedWash 3100']],
  Generator: [['Generac', 'GP3600'], ['Honda', 'EU2200i'], ['Champion', '4500']],
  Tiller: [['Troy-Bilt', 'Bronco'], ['Honda', 'FG110']],
}

const HOMEOWNER_TYPES: UnitType[] = ['Push Mower', 'Push Mower', 'Self-Propelled Mower', 'Riding Mower', 'Chainsaw', 'String Trimmer', 'Handheld Blower', 'Pressure Washer', 'Generator', 'Tiller', 'Hedge Trimmer']
const PRO_TYPES: UnitType[] = ['Zero-Turn Mower', 'Zero-Turn Mower', 'Zero-Turn Mower', 'String Trimmer', 'String Trimmer', 'Backpack Blower', 'Backpack Blower', 'Edger', 'Hedge Trimmer', 'Chainsaw']

// Target status mix for open work, plus closed history.
const STATUS_PLAN: [ROStatus, number][] = [
  ['estimate', 4], ['checked_in', 6], ['diagnosing', 5], ['awaiting_ok', 9], ['parts_on_order', 8],
  ['in_progress', 7], ['ready', 8], ['closed', 45],
]

export function makeSeed(now = Date.now()): DB {
  const r = mulberry32(20261006)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const iso = (daysAgo: number, hourJitter = true) =>
    new Date(now - daysAgo * 86_400_000 - (hourJitter ? int(0, 8) * 3_600_000 : 0)).toISOString()
  let idn = 0
  const id = (p: string) => `${p}-${(++idn).toString(36)}`
  const phone = () => `(405) 555-${String(int(1000, 9999))}`

  const settings = { ...defaultSettings }

  // Parts
  const srpOf = (cost: number) => round2(Math.ceil(cost * 1.65 * 4) / 4 - 0.01) // ~65% markup, priced to .x9
  const bin = () => `${String.fromCharCode(65 + int(0, 7))}${int(1, 12)}-${int(1, 6)}`
  const parts: Part[] = PARTS_RAW.map(([partNo, description, vendor, cost, onHand]) => ({
    id: id('p'), line: VENDOR_LINE[vendor] ?? 'OTHER', partNo, description, vendor, cost, onHand,
    price: srpOf(cost), bin: bin(), supersededBy: '', priceUpdatedAt: iso(int(60, 400)),
  }))
  const prefix: Record<string, () => string> = {
    SCAG: () => `48${int(1000, 9999)}`,
    EXMARK: () => `${int(103, 139)}-${int(1000, 9999)}`,
    STIHL: () => `${int(1121, 4238)} ${int(100, 999)} ${int(1000, 9999)}`,
    ECHO: () => `${['A', 'P', 'V', 'X'][int(0, 3)]}${int(100000, 999999)}${int(100, 999)}`,
    SHINDAIWA: () => `${['A', 'P', 'X'][int(0, 2)]}${int(100000, 999999)}${int(100, 999)}`,
    TORO: () => `${int(100, 140)}-${int(1000, 9999)}`,
  }
  for (const [line, list] of Object.entries(LINE_PARTS)) {
    for (const [description, cost] of list) {
      parts.push({
        id: id('p'), line, partNo: prefix[line](), description, vendor: defaultLines.find((l) => l.code === line)!.name,
        cost, price: srpOf(cost), onHand: r() < 0.15 ? 0 : int(1, 14), bin: bin(), supersededBy: '', priceUpdatedAt: iso(int(60, 400)),
      })
    }
  }
  const partByNo = Object.fromEntries(parts.map((p) => [p.partNo, p]))

  // Customers + units
  const customers: Customer[] = []
  const units: Unit[] = []
  let custNo = 2401
  const usedNames = new Set<string>()
  for (let i = 0; i < 42; i++) {
    const isBusiness = i < BIZ.length
    let name = isBusiness ? BIZ[i] : `${pick(FIRST)} ${pick(LAST)}`
    while (usedNames.has(name)) name = `${pick(FIRST)} ${pick(LAST)}`
    usedNames.add(name)
    const c: Customer = {
      id: id('c'), number: custNo++, name, phone: phone(),
      email: isBusiness ? `office@${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.example` : '',
      isBusiness, notes: isBusiness ? 'Commercial account — call office for approvals.' : '',
      createdAt: iso(int(200, 900)),
    }
    const [city, zip] = pick(TOWNS)
    c.address = `${int(100, 9999)} ${pick(STREETS)}`; c.city = city; c.state = 'OK'; c.zip = zip
    c.category = isBusiness ? (BIZ_CATEGORY[name] ?? 'Landscape') : 'Personal Use'
    if (c.category === 'Government' || c.category === 'Farm') c.taxExempt = true
    if (isBusiness) { c.contact1 = `${pick(FIRST)} ${pick(LAST)}`; c.priceLevel = 'Dealer Pricing' }
    else if (r() < 0.4) c.cellPhone = phone()
    customers.push(c)
    const n = isBusiness ? int(3, 6) : int(1, 2)
    for (let k = 0; k < n; k++) {
      const type = pick(isBusiness ? PRO_TYPES : HOMEOWNER_TYPES)
      const [make, model] = pick(UNIT_MODELS[type])
      const big = type === 'Zero-Turn Mower' || type === 'Riding Mower'
      units.push({
        id: id('u'), customerId: c.id, type, make, model,
        serial: `${make.slice(0, 2).toUpperCase()}${int(100000, 999999)}${String.fromCharCode(65 + int(0, 25))}`,
        engineHours: big ? int(40, 1400) : null,
      })
    }
  }

  // A church (tax exempt) and an old duplicate record — the kind of mess real imports have.
  {
    const church: Customer = {
      id: id('c'), number: custNo++, name: 'Cedar Hollow Fellowship', phone: phone(), email: '', isBusiness: true,
      notes: 'Tax-exempt certificate on file.', createdAt: iso(int(200, 900)), category: 'Church', taxExempt: true,
      contact1: `${pick(FIRST)} ${pick(LAST)}`, address: '516 W Forest Dr', city: 'Mustang', state: 'OK', zip: '73064',
    }
    customers.push(church)
    units.push({ id: id('u'), customerId: church.id, type: 'Riding Mower', make: 'Toro', model: 'TimeCutter 42', serial: `TO${int(100000, 999999)}C`, engineHours: int(80, 600) })
    const orig = customers[BIZ.length + 2]
    customers.push({
      id: id('c'), number: custNo++, name: orig.name, phone: orig.cellPhone ?? orig.phone, email: '', isBusiness: false,
      notes: '', createdAt: iso(int(1400, 1800)), category: 'Personal Use',
      address: orig.address, city: orig.city, state: 'OK', zip: orig.zip,
    })
  }

  // Repair orders
  const ros: RepairOrder[] = []
  let roNo = 10412
  const plan: ROStatus[] = STATUS_PLAN.flatMap(([s, n]) => Array(n).fill(s))
  // Shuffle so RO numbers aren't grouped by status
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[plan[i], plan[j]] = [plan[j], plan[i]]
  }

  // Assign ages: closed ones spread over a year, open ones mostly recent with a stale tail.
  const openAges = (s: ROStatus) => {
    const roll = r()
    if (s === 'awaiting_ok' && roll < 0.3) return int(25, 150) // the classic forgotten estimate
    if (s === 'parts_on_order' && roll < 0.35) return int(14, 60)
    if (s === 'ready' && roll < 0.25) return int(25, 110) // never picked up
    if (roll < 0.08) return int(35, 160)
    return int(0, 12)
  }
  const closedAge = () => (r() < 0.6 ? int(1, 40) : int(41, 360))

  plan.forEach((status) => {
    const unit = pick(units)
    const job = JOBS.filter((j) => j.types.includes(unit.type))
    const tpl = job.length ? pick(job) : JOBS[1]
    const tech = pick(TECHS)
    const ageDays = status === 'closed' ? closedAge() : openAges(status)
    const openedAt = iso(ageDays)
    const warranty = r() < 0.1

    const stage = STATUS_ORDER.indexOf(status)
    const diagnosed = stage >= STATUS_ORDER.indexOf('awaiting_ok') || status === 'estimate'
    const zeroOut = (status === 'awaiting_ok' || status === 'estimate') && r() < 0.2 // forgot to build estimate

    const labor: LaborLine[] = diagnosed && !zeroOut
      ? tpl.labor.map(([d, h]) => ({ id: id('l'), description: d, techId: tech.id, hours: Math.max(0.2, Math.round(h * pick([0.7, 0.8, 1, 1, 1.2, 1.5]) * 10) / 10), rate: settings.laborRate }))
      : []
    const parts_: PartLine[] = diagnosed && !zeroOut
      ? tpl.parts.map(([no, qty]) => {
          const p = partByNo[no]
          let st: PartLine['status'] = 'in_stock'
          if (status === 'parts_on_order') st = r() < 0.3 ? 'back_ordered' : 'ordered'
          else if (stage > STATUS_ORDER.indexOf('parts_on_order') && p.onHand < 3) st = 'received'
          return { id: id('pl'), partId: p.id, partNo: p.partNo, description: p.description, qty, unitPrice: p.price, status: st }
        })
      : []
    const laborTotal = labor.reduce((a, l) => a + l.hours * l.rate, 0)
    const fees: FeeLine[] = labor.length
      ? [{ id: id('f'), description: 'Shop supplies', amount: round2(laborTotal * settings.shopSuppliesPct / 100), taxable: true }]
      : []
    if (labor.length && /oil|service|tune/i.test(tpl.correction) && r() < 0.6)
      fees.push({ id: id('f'), description: 'Oil / fluid disposal', amount: 4.5, taxable: true })

    const estTotal = round2(laborTotal + parts_.reduce((a, p) => a + p.qty * p.unitPrice, 0) + fees.reduce((a, f) => a + f.amount, 0))
    const approvals: Approval[] = []
    const timeline: TimelineEvent[] = []
    const counter = pick(STAFF.filter((s) => s.role !== 'tech'))
    timeline.push({ id: id('e'), at: openedAt, kind: 'created', text: 'Repair order opened', user: counter.name })

    // Walk the status path up to the current status, spreading timestamps.
    const path = STATUS_ORDER.slice(1, stage + 1).filter((s) => s !== 'estimate')
    let t = new Date(openedAt).getTime()
    const endT = status === 'closed' ? new Date(openedAt).getTime() + int(2, 12) * 86_400_000 : now
    // Most activity happens early; the last update is what drives "idle" days.
    const idleTail = status === 'closed' ? 0 : Math.min(ageDays, ageDays > 20 ? int(Math.floor(ageDays * 0.6), ageDays) : int(0, ageDays))
    const activeEnd = endT - idleTail * 86_400_000
    const step = path.length ? Math.max(3_600_000, (activeEnd - t) / path.length) : 0
    for (const s of path) {
      t = Math.min(activeEnd, t + step)
      const at = new Date(t).toISOString()
      if (s === 'parts_on_order' && status !== 'parts_on_order' && r() < 0.5) continue
      if (s === 'awaiting_ok' || (s === 'in_progress' && !approvals.length && !warranty)) {
        if (s === 'in_progress' && estTotal > 0) {
          const c = customers.find((cc) => cc.id === unit.customerId)!
          approvals.push({ id: id('a'), amount: round2(estTotal * 1.0875), approvedBy: c.isBusiness ? 'Office manager' : c.name.split(' ')[0],
            method: pick(['phone', 'phone', 'text', 'in_person'] as const), at, recordedBy: counter.name })
          timeline.push({ id: id('e'), at, kind: 'approval', text: `Customer approved ${'$' + round2(estTotal * 1.0875).toFixed(2)}`, user: counter.name })
        }
      }
      timeline.push({ id: id('e'), at, kind: 'status', text: `Status → ${STATUS_LABEL[s]}`, user: s === 'diagnosing' || s === 'in_progress' ? tech.name : counter.name })
      if (s === 'awaiting_ok' && r() < 0.6) {
        timeline.push({ id: id('e'), at, kind: 'note', text: pick(['Left voicemail with estimate.', 'Texted estimate, no reply yet.', 'Customer wants to think about it.', 'Called — will call back after payday.']), user: counter.name })
      }
    }
    if (status === 'estimate') {
      timeline.push({ id: id('e'), at: openedAt, kind: 'note', text: 'Phone quote — unit not dropped off yet.', user: counter.name })
    }
    const updatedAt = timeline[timeline.length - 1].at

    ros.push({
      id: id('ro'), number: roNo++, customerId: unit.customerId, unitId: unit.id, status, warranty,
      techId: stage >= 2 ? tech.id : null,
      openedAt, updatedAt, closedAt: status === 'closed' ? updatedAt : null,
      promiseDate: status !== 'closed' && status !== 'estimate' && r() < 0.6 ? iso(ageDays - int(3, 10), false) : null,
      complaint: tpl.complaint,
      cause: diagnosed ? tpl.cause : '',
      correction: stage >= STATUS_ORDER.indexOf('ready') ? tpl.correction : '',
      dropOffNotes: r() < 0.3 ? pick(['Customer will be out of town until Friday.', 'Call cell, not home phone.', 'Bagger left with unit.', 'Needs it back before the weekend if possible.']) : '',
      checklist: { hasFuel: r() < 0.6, bladeOn: true, batteryIncluded: unit.type === 'Zero-Turn Mower' || unit.type === 'Riding Mower', accessories: r() < 0.2 ? 'Bagger' : '' },
      labor, parts: parts_, fees, approvals, timeline,
    })
  })

  // ---- Wholegoods ----
  const wholegoods: Wholegood[] = []
  let stock = 5100
  const soldUnits: Wholegood[] = []
  for (const [line, models] of Object.entries(WG_MODELS)) {
    for (const [category, model, description, dp, srp, qty] of models) {
      for (let k = 0; k < qty; k++) {
        const roll = r()
        const status: WholegoodStatus = roll < 0.12 ? 'on_order' : roll < 0.3 ? 'sold' : roll < 0.34 ? 'demo' : 'in_stock'
        // Big iron tends to sit longer; a few units are badly aged.
        const big = dp > 3000
        const age = status === 'on_order' ? 0 : r() < 0.15 ? int(200, 520) : int(3, big ? 190 : 120)
        const receivedAt = status === 'on_order' ? null : iso(age)
        const soldAt = status === 'sold' ? iso(int(0, Math.max(1, age - 1))) : null
        const floorPlan = big && status !== 'sold'
        const wg: Wholegood = {
          id: id('wg'), line, stockNo: String(stock++), category, model, description,
          serial: status === 'on_order' && r() < 0.5 ? '' : wgSerial(line, int),
          year: age > 365 ? 2025 : 2026, condition: 'new', status, dp, srp,
          orderedAt: iso(age + int(10, 40)), receivedAt,
          floorPlan, floorPlanDue: floorPlan && receivedAt ? new Date(new Date(receivedAt).getTime() + 270 * 86_400_000).toISOString() : null,
          soldAt, soldPrice: status === 'sold' ? round2(srp * (0.9 + r() * 0.1)) : null,
          soldToCustomerId: null, customerUnitId: null, notes: status === 'demo' ? 'Demo unit — used for customer test drives.' : '',
        }
        wholegoods.push(wg)
        if (status === 'sold') soldUnits.push(wg)
      }
    }
  }
  // Tie sold units to customers as customer-owned units.
  for (const wg of soldUnits) {
    const c = pick(customers)
    const u: Unit = { id: id('u'), customerId: c.id, type: wg.category, make: defaultLines.find((l) => l.code === wg.line)!.name, model: wg.model, serial: wg.serial, engineHours: null }
    units.push(u)
    wg.soldToCustomerId = c.id
    wg.customerUnitId = u.id
  }
  // A couple of used trade-ins in the Other line
  wholegoods.push({
    id: id('wg'), line: 'OTHER', stockNo: String(stock++), category: 'Riding Mower', model: 'S120 42"', description: 'Used — trade-in, 312 hrs',
    serial: 'JD' + int(100000, 999999), year: 2021, condition: 'used', status: 'in_stock', dp: 900, srp: 1650,
    orderedAt: null, receivedAt: iso(64), floorPlan: false, floorPlanDue: null, soldAt: null, soldPrice: null,
    soldToCustomerId: null, customerUnitId: null, notes: 'New blades + service done.',
  })

  // Claim tags on everything still in the shop (letter + number, like the paper tags hung on units)
  ros.forEach((ro, i) => { ro.tag = `${'ABCDE'[i % 5]}${10 + ((i * 37) % 90)}` })

  const db: DB = {
    version: DB_VERSION,
    settings,
    customers,
    units,
    lines: defaultLines.map((l) => ({ ...l })),
    parts,
    wholegoods,
    staff: STAFF,
    ros,
    nextRONumber: roNo,
    nextCustomerNumber: custNo,
    currentUserId: 's-ana',
    importLog: [],
    auditLog: [],
  }
  ensureCashCustomer(db)
  return db
}

function wgSerial(line: string, int: (a: number, b: number) => number) {
  switch (line) {
    case 'SCAG': return `S${int(10, 99)}${int(10000, 99999)}`
    case 'EXMARK': return `${int(410, 419)}${int(100000, 999999)}`
    case 'STIHL': return `${int(500000000, 599999999)}`
    case 'ECHO': return `T${int(10, 99)}${int(100000, 999999)}`
    case 'SHINDAIWA': return `S${int(10, 99)}${int(100000, 999999)}`
    case 'TORO': return `${int(4, 4)}${int(10000000, 19999999)}`
    default: return `${int(10000000, 99999999)}`
  }
}

// category, model, description, DP, SRP, how many to stock
const WG_MODELS: Record<string, [UnitType, string, string, number, number, number][]> = {
  SCAG: [
    ['Zero-Turn Mower', 'STTII-61V-27FX', 'Turf Tiger II 61" Kawasaki FX', 12950, 16299, 3],
    ['Zero-Turn Mower', 'SPRO-52V-24FR', 'Patriot 52" Kawasaki FR', 8350, 10499, 3],
    ['Zero-Turn Mower', 'SFZ48-22FR', 'Freedom Z 48" Kawasaki FR', 5590, 6999, 4],
    ['Zero-Turn Mower', 'SVRII-52V-23FX', 'V-Ride II 52" stand-on', 9790, 12299, 2],
    ['Zero-Turn Mower', 'SCZII-61V-37BV', 'Cheetah II 61" Briggs Vanguard', 14780, 18599, 1],
  ],
  EXMARK: [
    ['Zero-Turn Mower', 'LZS38CKC604', 'Lazer Z S-Series 60" Kawasaki', 10390, 12999, 3],
    ['Zero-Turn Mower', 'RAS708GEM52400', 'Radius S 52" Exmark 708cc', 6390, 7999, 4],
    ['Zero-Turn Mower', 'QZE708GEM50200', 'Quest E 50"', 4150, 5199, 3],
    ['Zero-Turn Mower', 'STS691EKA52400', 'Staris E 52" stand-on', 7990, 9999, 2],
    ['Zero-Turn Mower', 'VTS730CKA60400', 'Vertex 60" stand-on', 11550, 14499, 1],
  ],
  STIHL: [
    ['Chainsaw', 'MS 271', 'Farm Boss 20"', 335, 459.99, 5],
    ['Chainsaw', 'MS 250', '18" homeowner saw', 270, 369.99, 6],
    ['Chainsaw', 'MS 462 R C-M', '25" pro saw', 940, 1279.99, 2],
    ['String Trimmer', 'FS 91 R', 'Pro trimmer, bike handle', 285, 389.99, 6],
    ['String Trimmer', 'FS 131 R', '4-MIX pro trimmer', 365, 499.99, 3],
    ['Backpack Blower', 'BR 800 C-E', 'Magnum backpack blower', 520, 709.99, 4],
    ['Handheld Blower', 'BG 86', 'Pro handheld blower', 225, 299.99, 4],
    ['Hedge Trimmer', 'HS 82 R', '24" hedge trimmer', 395, 539.99, 2],
    ['Edger', 'FC 91', 'Pro edger', 335, 459.99, 3],
  ],
  ECHO: [
    ['String Trimmer', 'SRM-2620T', 'Pro trimmer, high-torque', 270, 379.99, 6],
    ['String Trimmer', 'SRM-3020T', 'Pro trimmer 30.5cc', 335, 469.99, 3],
    ['Backpack Blower', 'PB-9010T', 'Backpack blower 79.9cc, tube throttle', 545, 749.99, 3],
    ['Backpack Blower', 'PB-580T', 'Backpack blower 58.2cc', 310, 429.99, 4],
    ['Chainsaw', 'CS-590', 'Timber Wolf 20"', 330, 459.99, 3],
    ['Chainsaw', 'CS-4510', 'Rear-handle 18"', 270, 369.99, 3],
    ['Edger', 'PE-2620', 'Pro edger', 255, 349.99, 3],
    ['Hedge Trimmer', 'HCA-2620', 'Articulating hedge trimmer', 310, 429.99, 1],
  ],
  SHINDAIWA: [
    ['String Trimmer', 'T262', 'Pro trimmer 25.4cc', 280, 389.99, 4],
    ['String Trimmer', 'C302', 'Brushcutter, bike handle', 360, 499.99, 2],
    ['Backpack Blower', 'EB810', 'Backpack blower 79.9cc', 520, 719.99, 2],
    ['Edger', 'LE231', 'Edger, curved shaft', 240, 329.99, 2],
    ['Hedge Trimmer', 'DH235', 'Double-sided hedge trimmer', 300, 419.99, 1],
  ],
  TORO: [
    ['Self-Propelled Mower', '21466', 'Recycler 22" Personal Pace', 455, 619.99, 5],
    ['Self-Propelled Mower', '21199', 'TimeMaster 30" Personal Pace', 1040, 1399.99, 3],
    ['Zero-Turn Mower', '75755', 'TimeCutter 50" MyRide', 3510, 4599, 3],
    ['Zero-Turn Mower', '75314', 'Titan 60" MyRide', 5850, 7599, 2],
    ['Zero-Turn Mower', '74090', 'Z Master 4000 60" HDX', 12650, 15999, 1],
    ['Zero-Turn Mower', '74513', 'Grandstand 52" stand-on', 8900, 11499, 1],
  ],
}
