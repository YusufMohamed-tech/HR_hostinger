export const EMPLOYEE_ACCOUNT_PASSWORD_MESSAGE =
  "كلمة المرور يجب أن تكون 12 حرفًا على الأقل وتحتوي على حرف كبير وصغير ورقم.";

export const EMPLOYEE_ACCOUNT_PASSWORD_CONFIRMATION_MESSAGE = "تأكيد كلمة المرور غير مطابق.";

export function isStrongEmployeeAccountPassword(password: string) {
  return password.length >= 12
    && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}
