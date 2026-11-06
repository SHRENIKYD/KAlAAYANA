const enquiryForm = document.querySelector('.contact-form');
if (enquiryForm) {
  enquiryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!enquiryForm.reportValidity()) return;
    const status = enquiryForm.querySelector('.contact-status');
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enquiryForm.dataset.recipient || '')) {
        throw new Error('Invalid recipient configuration');
      }
      const fields = new FormData(enquiryForm);
      const name = String(fields.get('name') || '').trim();
      const email = String(fields.get('email') || '').trim();
      const type = String(fields.get('projectType') || '').trim();
      const message = String(fields.get('message') || '').trim();
      const subject = `Kalaayana enquiry: ${type}`;
      const body = `Name: ${name}\nEmail: ${email}\nProject type: ${type}\n\n${message}`;
      window.location.href = `mailto:${enquiryForm.dataset.recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      if (status)
        status.textContent =
          'Your email app should open with a draft. Send it there to complete your enquiry, or use the email link below.';
    } catch {
      window.KalaayanaDiagnostics?.report('contact_failed');
      if (status)
        status.textContent =
          'Unable to open an email draft. Please use the email link below to contact the studio.';
    }
  });
}
