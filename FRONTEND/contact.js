// contact.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");
  const responseBox = document.getElementById("formResponse");

  form.addEventListener("submit", async (e) => {
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

    try {
      const res = await fetch("http://localhost:5001/api/contact", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, email, message }),
});


      const data = await res.json();

      if (data.success) {
        responseBox.textContent = `✅ Thank you, ${name}! Your message has been received.`;
        responseBox.className = "mt-6 text-center text-lg font-semibold text-green-700";
        form.reset();
      } else {
        responseBox.textContent = `❌ Failed to send message: ${data.message || "Server error"}`;
        responseBox.className = "mt-6 text-center text-lg font-semibold text-red-600";
      }
    } catch (err) {
      console.error(err);
      responseBox.textContent = "❌ Error: Could not connect to server.";
      responseBox.className = "mt-6 text-center text-lg font-semibold text-red-600";
    }

    responseBox.classList.remove("hidden");
  });
});
