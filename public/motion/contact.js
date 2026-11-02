const enquiryForm = document.querySelector('.contact-form');
if (enquiryForm) {
  enquiryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!enquiryForm.reportValidity()) return;
    const fields = new FormData(enquiryForm);
    const name = String(fields.get('name') || '').trim();
    const email = String(fields.get('email') || '').trim();
    const type = String(fields.get('projectType') || '').trim();
    const message = String(fields.get('message') || '').trim();
    const subject = `Kalaayana enquiry: ${type}`;
    const body = `Name: ${name}\nEmail: ${email}\nProject type: ${type}\n\n${message}`;
    window.location.href = `mailto:${enquiryForm.dataset.recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    enquiryForm.querySelector('.contact-status').textContent =
      'Your email app should open with a draft. Send it there to complete your enquiry, or use the email link below.';
  });
}
