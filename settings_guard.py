"""One place that decides who may change system-wide settings.

Authenticated mode: ``access_control.authorize`` already requires a global
administrator for these routes, so the handler only has to read the real
username for the audit trail. The simulated role picked in the UI is ignored.

Demo mode (no login required): the prototype's simulated role decides, as before.
"""
OFFICER = 'เจ้าหน้าที่พัสดุ'
DEMO_DENIED = 'การตั้งค่าใช้บทบาทเจ้าหน้าที่พัสดุในโหมดทดสอบ'
ADMIN_DENIED = 'การแก้การตั้งค่ากลางต้องใช้ผู้ดูแลระบบส่วนกลาง'


def settings_editor(db, actor, deny):
    """Return the name to record in audit logs, or call ``deny(message)`` (which must raise)."""
    ctx = getattr(db, 'access', None)
    if ctx:
        if not ctx.get('isAdmin'):
            deny(ADMIN_DENIED)
        return ctx['user']['username']
    if actor != OFFICER:
        deny(DEMO_DENIED)
    return OFFICER
