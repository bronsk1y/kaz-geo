var links = document.querySelectorAll(".link");

links.forEach(link => {
    link.addEventListener("mouseenter", () => {
        gsap.to(link, {
            color: "black",
            duration: 0.3,
        })
    })
    link.addEventListener("mouseleave", () => {
        gsap.to(link, {
            color: "#b0aea5",
            duration: 0.3
        })
    })
});
