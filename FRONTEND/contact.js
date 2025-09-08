// contact.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  const responseBox = document.getElementById("formResponse");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const message = document.getElementById("message").value.trim();

    if (!name || !email || !message) {
      responseBox.textContent = "⚠️ Please fill out all fields.";
      responseBox.className = "mt-6 text-center text-lg font-semibold text-red-600";
      responseBox.classList.remove("hidden");
      return;
    }

    // Simulated response (later this will connect to backend API)
    setTimeout(() => {
      responseBox.textContent = `✅ Thank you, ${name}! Your message has been received.`;
      responseBox.className = "mt-6 text-center text-lg font-semibold text-green-700";
      responseBox.classList.remove("hidden");
      form.reset();
    }, 1000);
  });
});
