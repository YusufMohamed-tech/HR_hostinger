export interface ActionGuide {
  id: string;
  title: string;
  titleAr: string;
  module: string;
  requiredRoles: string[];
  steps: { order: number; instruction: string; uiElement?: string; tip?: string }[];
  stepsAr: { order: number; instruction: string; uiElement?: string; tip?: string }[];
  route: string;
}

export const actionGuides: ActionGuide[] = [
  {
    id: "add_employee",
    title: "Add a New Employee",
    titleAr: "إضافة موظف جديد",
    module: "HR",
    requiredRoles: ["super_admin", "admin", "hr_admin"],
    route: "/employees",
    steps: [
      { order: 1, instruction: 'Navigate to "Employees" from the sidebar menu', uiElement: "Sidebar > Employees" },
      { order: 2, instruction: 'Click the "Add Employee" button in the top right', uiElement: "Button: Add Employee" },
      { order: 3, instruction: "Fill in the required fields: Full Name, Employee ID, Department, Position, and Hire Date" },
      { order: 4, instruction: "Optionally fill in: Phone, Email, Nationality, ID Number, Bank Details" },
      { order: 5, instruction: "Set the salary details: Basic Salary, Housing Allowance, Transport Allowance" },
      { order: 6, instruction: 'Click "Save" to create the employee record', uiElement: "Button: Save" },
      { order: 7, instruction: "The system will create a login account if email is provided", tip: "An email invitation will be sent automatically" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الموظفين" من القائمة الجانبية', uiElement: "القائمة الجانبية > الموظفين" },
      { order: 2, instruction: 'اضغط على زر "إضافة موظف" في أعلى اليمين', uiElement: "زر: إضافة موظف" },
      { order: 3, instruction: "املأ الحقول المطلوبة: الاسم الكامل، رقم الموظف، القسم، المنصب، تاريخ التعيين" },
      { order: 4, instruction: "اختياريًا: رقم الهاتف، البريد الإلكتروني، الجنسية، رقم الهوية، تفاصيل البنك" },
      { order: 5, instruction: "حدد تفاصيل الراتب: الراتب الأساسي، بدل السكن، بدل النقل" },
      { order: 6, instruction: 'اضغط "حفظ" لإنشاء سجل الموظف', uiElement: "زر: حفظ" },
      { order: 7, instruction: "سيقوم النظام بإنشاء حساب دخول إذا تم توفير البريد الإلكتروني", tip: "سيتم إرسال دعوة بالبريد الإلكتروني تلقائيًا" },
    ],
  },
  {
    id: "submit_leave_request",
    title: "Submit a Leave Request",
    titleAr: "تقديم طلب إجازة",
    module: "Leave",
    requiredRoles: ["employee", "admin", "hr_admin", "sales", "sales_manager", "finance_manager", "accountant"],
    route: "/leaves",
    steps: [
      { order: 1, instruction: 'Navigate to "Leaves" from the sidebar menu', uiElement: "Sidebar > Leaves" },
      { order: 2, instruction: 'Click "Request Leave" button', uiElement: "Button: Request Leave" },
      { order: 3, instruction: "Select the leave type (Annual, Sick, Emergency, etc.)" },
      { order: 4, instruction: "Choose the start date and end date" },
      { order: 5, instruction: "Add a reason/note for the leave" },
      { order: 6, instruction: 'Click "Submit" to send for approval', uiElement: "Button: Submit" },
      { order: 7, instruction: "Your manager or HR will review and approve/reject the request", tip: "You will receive a notification when the decision is made" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الإجازات" من القائمة الجانبية', uiElement: "القائمة الجانبية > الإجازات" },
      { order: 2, instruction: 'اضغط على زر "طلب إجازة"', uiElement: 'زر: طلب إجازة' },
      { order: 3, instruction: "اختر نوع الإجازة (سنوية، مرضية، طارئة، إلخ)" },
      { order: 4, instruction: "حدد تاريخ البداية وتاريخ النهاية" },
      { order: 5, instruction: "أضف سبب/ملاحظة للإجازة" },
      { order: 6, instruction: 'اضغط "إرسال" لتقديم الطلب للموافقة', uiElement: "زر: إرسال" },
      { order: 7, instruction: "سيقوم مديرك أو الموارد البشرية بمراجعة الطلب والموافقة/الرفض", tip: "ستتلقى إشعارًا عند اتخاذ القرار" },
    ],
  },
  {
    id: "approve_leave",
    title: "Approve or Reject a Leave Request",
    titleAr: "الموافقة على أو رفض طلب إجازة",
    module: "Leave",
    requiredRoles: ["admin", "hr_admin"],
    route: "/leaves",
    steps: [
      { order: 1, instruction: 'Navigate to "Leaves" from the sidebar menu' },
      { order: 2, instruction: "Find the pending leave request in the list (status: Pending)" },
      { order: 3, instruction: "Click on the request to view details" },
      { order: 4, instruction: "Review the dates, type, reason, and remaining balance" },
      { order: 5, instruction: 'Click "Approve" to approve or "Reject" with a mandatory note', tip: "Rejection requires a reason to be provided" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الإجازات" من القائمة الجانبية' },
      { order: 2, instruction: "ابحث عن طلب الإجازة المعلق في القائمة (الحالة: معلق)" },
      { order: 3, instruction: "اضغط على الطلب لعرض التفاصيل" },
      { order: 4, instruction: "راجع التواريخ، النوع، السبب، والرصيد المتبقي" },
      { order: 5, instruction: 'اضغط "موافقة" للموافقة أو "رفض" مع ملاحظة إلزامية', tip: "الرفض يتطلب تقديم سبب" },
    ],
  },
  {
    id: "check_in_attendance",
    title: "Check In for Attendance",
    titleAr: "تسجيل حضور",
    module: "Attendance",
    requiredRoles: ["employee", "sales", "field_agent", "promoter"],
    route: "/attendance",
    steps: [
      { order: 1, instruction: 'Navigate to "Attendance" from the sidebar menu' },
      { order: 2, instruction: 'Click the "Check In" button' },
      { order: 3, instruction: "Allow location access when prompted by the browser" },
      { order: 4, instruction: "Take a selfie when the camera opens (if required)" },
      { order: 5, instruction: "The system will validate your GPS location against your assigned work location" },
      { order: 6, instruction: "Once validated, your check-in time is recorded", tip: "Make sure you are within the geofence radius of your work location" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الحضور" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "تسجيل حضور"' },
      { order: 3, instruction: "اسمح بالوصول إلى الموقع عند طلب المتصفح" },
      { order: 4, instruction: "التقط صورة سيلفي عند فتح الكاميرا (إذا مطلوب)" },
      { order: 5, instruction: "سيتحقق النظام من موقع GPS الخاص بك مقابل موقع العمل المحدد" },
      { order: 6, instruction: "بمجرد التحقق، يتم تسجيل وقت حضورك", tip: "تأكد أنك داخل نطاق السياج الجغرافي لموقع عملك" },
    ],
  },
  {
    id: "run_payroll",
    title: "Run Monthly Payroll",
    titleAr: "تشغيل الرواتب الشهرية",
    module: "Payroll",
    requiredRoles: ["admin", "hr_admin", "finance_manager"],
    route: "/payroll",
    steps: [
      { order: 1, instruction: 'Navigate to "Payroll" from the sidebar menu' },
      { order: 2, instruction: "Select the target month and year" },
      { order: 3, instruction: 'Click "Run Payroll" to calculate all employee payslips' },
      { order: 4, instruction: "Review the generated payslips for accuracy" },
      { order: 5, instruction: "Make any manual adjustments if needed (bonus/deduction)" },
      { order: 6, instruction: "Transition status from Draft → Approved → Paid" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الرواتب" من القائمة الجانبية' },
      { order: 2, instruction: "اختر الشهر والسنة المستهدفة" },
      { order: 3, instruction: 'اضغط "تشغيل الرواتب" لحساب كشوف رواتب جميع الموظفين' },
      { order: 4, instruction: "راجع كشوف الرواتب المُنشأة للتأكد من دقتها" },
      { order: 5, instruction: "قم بأي تعديلات يدوية إذا لزم الأمر (مكافأة/خصم)" },
      { order: 6, instruction: "انقل الحالة من مسودة ← معتمد ← مدفوع" },
    ],
  },
  {
    id: "create_task",
    title: "Create and Assign a Task",
    titleAr: "إنشاء وتعيين مهمة",
    module: "Tasks",
    requiredRoles: ["admin", "hr_admin", "sales_manager", "onground_agent_manager"],
    route: "/tasks",
    steps: [
      { order: 1, instruction: 'Navigate to "Tasks" from the sidebar menu' },
      { order: 2, instruction: 'Click "Create Task" button' },
      { order: 3, instruction: "Enter the task title and description" },
      { order: 4, instruction: "Set the priority (Low, Medium, High, Critical)" },
      { order: 5, instruction: "Choose the due date" },
      { order: 6, instruction: "Assign to one or more employees" },
      { order: 7, instruction: "Optionally attach files" },
      { order: 8, instruction: 'Click "Save" to create and notify the assigned employees' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "المهام" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "إنشاء مهمة"' },
      { order: 3, instruction: "أدخل عنوان المهمة والوصف" },
      { order: 4, instruction: "حدد الأولوية (منخفض، متوسط، عالي، حرج)" },
      { order: 5, instruction: "اختر تاريخ الاستحقاق" },
      { order: 6, instruction: "عيّن لموظف واحد أو أكثر" },
      { order: 7, instruction: "اختياريًا أرفق ملفات" },
      { order: 8, instruction: 'اضغط "حفظ" لإنشاء وإشعار الموظفين المعينين' },
    ],
  },
  {
    id: "create_job_posting",
    title: "Create a Job Posting",
    titleAr: "إنشاء إعلان وظيفي",
    module: "Recruitment",
    requiredRoles: ["admin", "hr_admin", "hr_recruitment"],
    route: "/recruitment",
    steps: [
      { order: 1, instruction: 'Navigate to "Recruitment" from the sidebar menu' },
      { order: 2, instruction: 'Click "Create Posting" button' },
      { order: 3, instruction: "Enter the job title, department, and location" },
      { order: 4, instruction: "Write the job description and requirements" },
      { order: 5, instruction: "Configure the application form (custom fields if needed)" },
      { order: 6, instruction: 'Set the posting status to "Open"' },
      { order: 7, instruction: "Share the public application link with candidates" },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "التوظيف" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "إنشاء إعلان"' },
      { order: 3, instruction: "أدخل المسمى الوظيفي، القسم، والموقع" },
      { order: 4, instruction: "اكتب وصف الوظيفة والمتطلبات" },
      { order: 5, instruction: "قم بتكوين نموذج التقديم (حقول مخصصة إذا لزم)" },
      { order: 6, instruction: 'اضبط حالة الإعلان إلى "مفتوح"' },
      { order: 7, instruction: "شارك رابط التقديم العام مع المرشحين" },
    ],
  },
  {
    id: "log_daily_sales",
    title: "Log Daily Sales",
    titleAr: "تسجيل المبيعات اليومية",
    module: "Sales",
    requiredRoles: ["sales", "sales_manager"],
    route: "/sales",
    steps: [
      { order: 1, instruction: 'Navigate to "Sales" from the sidebar menu' },
      { order: 2, instruction: "Click \"Add Sales Entry\" or find today's entry" },
      { order: 3, instruction: "Select the company and product" },
      { order: 4, instruction: "Enter the quantity and any serial numbers" },
      { order: 5, instruction: "Submit the entry" },
      { order: 6, instruction: 'To edit a submitted entry, submit an "Edit Request" for manager approval' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "المبيعات" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط "إضافة قيد مبيعات" أو ابحث عن قيد اليوم' },
      { order: 3, instruction: "اختر الشركة والمنتج" },
      { order: 4, instruction: "أدخل الكمية وأي أرقام تسلسلية" },
      { order: 5, instruction: "أرسل القيد" },
      { order: 6, instruction: 'لتعديل قيد مرسل، قدم "طلب تعديل" لموافقة المدير' },
    ],
  },
  {
    id: "create_department",
    title: "Create a Department",
    titleAr: "إنشاء قسم جديد",
    module: "HR",
    requiredRoles: ["super_admin", "admin", "hr_admin"],
    route: "/departments",
    steps: [
      { order: 1, instruction: 'Navigate to "Departments" from the sidebar menu' },
      { order: 2, instruction: 'Click "Add Department" button' },
      { order: 3, instruction: "Enter the department name" },
      { order: 4, instruction: "Optionally assign a department manager" },
      { order: 5, instruction: 'Click "Save" to create the department' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الأقسام" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "إضافة قسم"' },
      { order: 3, instruction: "أدخل اسم القسم" },
      { order: 4, instruction: "اختياريًا عيّن مدير القسم" },
      { order: 5, instruction: 'اضغط "حفظ" لإنشاء القسم' },
    ],
  },
  {
    id: "create_location",
    title: "Create a Work Location",
    titleAr: "إنشاء موقع عمل",
    module: "HR",
    requiredRoles: ["super_admin", "admin", "hr_admin"],
    route: "/locations",
    steps: [
      { order: 1, instruction: 'Navigate to "Locations" from the sidebar menu' },
      { order: 2, instruction: 'Click "Add Location" button' },
      { order: 3, instruction: "Enter the location name and address" },
      { order: 4, instruction: "Set the GPS coordinates using the map picker" },
      { order: 5, instruction: "Set the geofence radius (in meters)" },
      { order: 6, instruction: 'Click "Save" to create the location' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "المواقع" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "إضافة موقع"' },
      { order: 3, instruction: "أدخل اسم الموقع والعنوان" },
      { order: 4, instruction: "حدد إحداثيات GPS باستخدام منتقي الخريطة" },
      { order: 5, instruction: "حدد نطاق السياج الجغرافي (بالأمتار)" },
      { order: 6, instruction: 'اضغط "حفظ" لإنشاء الموقع' },
    ],
  },
  {
    id: "manage_schedule",
    title: "Create and Assign Shifts",
    titleAr: "إنشاء وتعيين الورديات",
    module: "Schedule",
    requiredRoles: ["admin", "hr_admin", "sales_manager"],
    route: "/schedule",
    steps: [
      { order: 1, instruction: 'Navigate to "Schedule" from the sidebar menu' },
      { order: 2, instruction: 'Click "Add Shift" to create a shift template' },
      { order: 3, instruction: "Set the shift name, start time, and end time" },
      { order: 4, instruction: "Choose the shift type (Morning, Night, Flexible)" },
      { order: 5, instruction: "Assign employees to the shift" },
      { order: 6, instruction: 'Click "Save" to activate the shift schedule' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الجدول" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط "إضافة وردية" لإنشاء قالب وردية' },
      { order: 3, instruction: "حدد اسم الوردية، وقت البدء، ووقت الانتهاء" },
      { order: 4, instruction: "اختر نوع الوردية (صباحية، ليلية، مرنة)" },
      { order: 5, instruction: "عيّن الموظفين للوردية" },
      { order: 6, instruction: 'اضغط "حفظ" لتفعيل جدول الوردية' },
    ],
  },
  {
    id: "view_notifications",
    title: "View and Manage Notifications",
    titleAr: "عرض وإدارة الإشعارات",
    module: "Notifications",
    requiredRoles: ["employee", "admin", "hr_admin", "sales", "sales_manager", "finance_manager"],
    route: "/notifications",
    steps: [
      { order: 1, instruction: "Click the bell icon in the top navigation bar" },
      { order: 2, instruction: "View unread notifications highlighted at the top" },
      { order: 3, instruction: "Click on a notification to see details and navigate to the related item" },
      { order: 4, instruction: 'Click "Mark all as read" to clear all notifications' },
    ],
    stepsAr: [
      { order: 1, instruction: "اضغط على أيقونة الجرس في شريط التنقل العلوي" },
      { order: 2, instruction: "اعرض الإشعارات غير المقروءة المميزة في الأعلى" },
      { order: 3, instruction: "اضغط على إشعار لرؤية التفاصيل والانتقال إلى العنصر المرتبط" },
      { order: 4, instruction: 'اضغط "تحديد الكل كمقروء" لمسح جميع الإشعارات' },
    ],
  },
  {
    id: "manage_assets",
    title: "Register a Company Asset",
    titleAr: "تسجيل أصل شركة",
    module: "Assets",
    requiredRoles: ["admin", "hr_admin"],
    route: "/assets",
    steps: [
      { order: 1, instruction: 'Navigate to "Assets" from the sidebar menu' },
      { order: 2, instruction: 'Click "Add Asset" button' },
      { order: 3, instruction: "Enter asset name, type, and serial number" },
      { order: 4, instruction: "Set the purchase date and value" },
      { order: 5, instruction: "Optionally assign custody to an employee" },
      { order: 6, instruction: 'Click "Save" to register the asset' },
    ],
    stepsAr: [
      { order: 1, instruction: 'انتقل إلى "الأصول" من القائمة الجانبية' },
      { order: 2, instruction: 'اضغط على زر "إضافة أصل"' },
      { order: 3, instruction: "أدخل اسم الأصل، النوع، والرقم التسلسلي" },
      { order: 4, instruction: "حدد تاريخ الشراء والقيمة" },
      { order: 5, instruction: "اختياريًا عيّن العهدة لموظف" },
      { order: 6, instruction: 'اضغط "حفظ" لتسجيل الأصل' },
    ],
  },
];

export function searchGuides(query: string, userRole?: string): ActionGuide[] {
  const q = query.toLowerCase();
  let results = actionGuides.filter(
    (g) =>
      g.title.toLowerCase().includes(q) ||
      g.titleAr.includes(query) ||
      g.id.includes(q.replace(/\s+/g, "_")) ||
      g.module.toLowerCase().includes(q) ||
      g.steps.some((s) => s.instruction.toLowerCase().includes(q))
  );

  if (userRole) {
    results = results.filter((g) => g.requiredRoles.includes(userRole));
  }

  return results.slice(0, 5);
}
