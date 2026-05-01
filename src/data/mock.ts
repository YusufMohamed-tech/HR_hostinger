export const organizations = [
  { id: "ORG-001", name: "Tatwir Retail", plan: "Enterprise", users: 420, status: "Active" },
  { id: "ORG-002", name: "Tatwir Logistics", plan: "Growth", users: 180, status: "Active" },
  { id: "ORG-003", name: "Tatwir Field Ops", plan: "Starter", users: 64, status: "Onboarding" },
];

export const employees = [
  {
    id: "EMP-001",
    name: "Ahmed Youssef",
    email: "ahmed.y@tatwir.com",
    role: "Employee",
    department: "Operations",
    location: "Site A - Downtown",
    status: "Active",
    phone: "+966 55 123 4567",
    manager: "Sarah Khaled",
    hireDate: "2024-11-12",
    contract: "CON-001",
  },
  {
    id: "EMP-002",
    name: "Sarah Khaled",
    email: "sarah.k@tatwir.com",
    role: "Team Leader",
    department: "Logistics",
    location: "Site B - East Mall",
    status: "Active",
    phone: "+966 55 222 9081",
    manager: "Nour Hassan",
    hireDate: "2023-05-03",
    contract: "CON-003",
  },
  {
    id: "EMP-003",
    name: "Tariq Ali",
    email: "tariq.a@tatwir.com",
    role: "Employee",
    department: "Operations",
    location: "Site A - Downtown",
    status: "On Leave",
    phone: "+966 55 764 9821",
    manager: "Sarah Khaled",
    hireDate: "2024-02-21",
    contract: "CON-004",
  },
  {
    id: "EMP-004",
    name: "Nour Hassan",
    email: "nour.h@tatwir.com",
    role: "Admin",
    department: "Human Resources",
    location: "Head Office",
    status: "Active",
    phone: "+966 55 876 6601",
    manager: "Executive Team",
    hireDate: "2022-06-15",
    contract: "CON-005",
  },
  {
    id: "EMP-005",
    name: "Omar Zaid",
    email: "omar.z@tatwir.com",
    role: "Employee",
    department: "Maintenance",
    location: "Site C - West Park",
    status: "Active",
    phone: "+966 55 342 9901",
    manager: "David Mansour",
    hireDate: "2024-09-30",
    contract: "CON-002",
  },
];

export const departments = [
  { id: "DEP-001", name: "Operations", head: "Sarah Khaled", headcount: 120, locations: 4 },
  { id: "DEP-002", name: "Logistics", head: "Tariq Ali", headcount: 62, locations: 3 },
  { id: "DEP-003", name: "Customer Care", head: "Nour Hassan", headcount: 28, locations: 1 },
];

export const locations = [
  { id: "LOC-001", name: "Site A - Downtown", city: "Riyadh", employees: 54, geofence: "Enabled", status: "Active" },
  { id: "LOC-002", name: "Site B - East Mall", city: "Riyadh", employees: 72, geofence: "Enabled", status: "Active" },
  { id: "LOC-003", name: "Site C - West Park", city: "Jeddah", employees: 38, geofence: "Setup Pending", status: "Draft" },
];

export const contracts = [
  { id: "CON-001", employee: "Ahmed Youssef", role: "Operator", start: "2025-08-01", end: "2026-07-31", salary: "5,200 SAR", status: "Active" },
  { id: "CON-002", employee: "Omar Zaid", role: "Technician", start: "2025-10-15", end: "2026-10-14", salary: "4,800 SAR", status: "Active" },
  { id: "CON-003", employee: "Sara Ahmed", role: "Team Leader", start: "2024-04-01", end: "2026-03-31", salary: "8,400 SAR", status: "Renewal Due" },
];

export const hierarchy = [
  { id: "H-001", name: "Nour Hassan", title: "HR Director", reports: 3 },
  { id: "H-002", name: "Sarah Khaled", title: "Operations Lead", reports: 5 },
  { id: "H-003", name: "David Mansour", title: "Field Ops Manager", reports: 8 },
];

export const events = [
  { id: "EVT-1001", type: "Check-in", employee: "Ahmed Youssef", location: "Site A - Downtown", time: "2026-05-01 08:05", payload: "GPS 24.7136, 46.6753" },
  { id: "EVT-1002", type: "Movement", employee: "Tariq Ali", location: "Site B - East Mall", time: "2026-05-01 09:18", payload: "Zone change: A2 -> B1" },
  { id: "EVT-1003", type: "Sales", employee: "Sara Ahmed", location: "Site B - East Mall", time: "2026-05-01 10:22", payload: "POS: 9 orders" },
];

export const kpiTargets = [
  {
    id: "KPI-01",
    name: "Attendance Rate",
    target: "95%",
    actual: "92%",
    trend: "-1.2%",
    series: [88, 90, 91, 93, 92, 91, 92],
    benchmark: "94%",
  },
  {
    id: "KPI-02",
    name: "Task Completion",
    target: "90%",
    actual: "94%",
    trend: "+2.3%",
    series: [82, 86, 89, 90, 92, 94, 94],
    benchmark: "91%",
  },
  {
    id: "KPI-03",
    name: "Sales per Shift",
    target: "120",
    actual: "110",
    trend: "-4.5%",
    series: [98, 105, 112, 118, 115, 110, 110],
    benchmark: "116",
  },
];

export const payrollRuns = [
  { id: "PAY-APR-2026", period: "Apr 2026", employees: 248, total: "1,820,000 SAR", status: "Draft" },
  { id: "PAY-MAR-2026", period: "Mar 2026", employees: 240, total: "1,740,000 SAR", status: "Completed" },
];

export const payrollPreview = [
  { id: "EMP-001", name: "Ahmed Youssef", base: "4,800", bonus: "350", deductions: "0", total: "5,150" },
  { id: "EMP-002", name: "Sarah Khaled", base: "7,600", bonus: "820", deductions: "120", total: "8,300" },
  { id: "EMP-003", name: "Omar Zaid", base: "4,400", bonus: "200", deductions: "0", total: "4,600" },
];

export const trackingAlerts = [
  { id: "TRK-001", location: "Site B - East Mall", issue: "Geofence drift detected", severity: "Medium" },
  { id: "TRK-002", location: "Site C - West Park", issue: "GPS signal loss", severity: "Low" },
];

export const aiInsights = [
  { id: "AI-01", title: "Late arrival spike", impact: "Medium", summary: "Site B late arrivals increased 14% vs last week." },
  { id: "AI-02", title: "High performer cluster", impact: "High", summary: "Team A exceeded KPI targets for 6 shifts in a row." },
  { id: "AI-03", title: "Shift coverage gap", impact: "Low", summary: "Tuesday evening slots are 20% understaffed." },
];

export const courses = [
  { id: "LMS-001", title: "Safety Onboarding", progress: 78, status: "In Progress", due: "2026-05-10" },
  { id: "LMS-002", title: "POS Excellence", progress: 100, status: "Completed", due: "2026-04-20" },
  { id: "LMS-003", title: "Customer Service Basics", progress: 42, status: "At Risk", due: "2026-05-15" },
];

export const auditLogs = [
  { id: "AUD-2301", actor: "Nour Hassan", action: "Updated contract", entity: "CON-003", time: "2026-05-01 09:11", status: "Success" },
  { id: "AUD-2302", actor: "Sarah Khaled", action: "Edited schedule", entity: "Shift-441", time: "2026-05-01 09:42", status: "Success" },
  { id: "AUD-2303", actor: "Ahmed Youssef", action: "Clocked in", entity: "EVT-1001", time: "2026-05-01 08:05", status: "Success" },
];
