

function createVis(data) {
  const width = 1200;
  const height = 800;

  // Create the SVG container.
  const svg = d3.select("#stack").append("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto;");

}


function init() {
    d3.json("./data/colors.json").then(data => {
        console.log(data);
        createVis(data);
    })
     .catch(error => console.error('Error loading data:', error));

}

window.addEventListener('load', init);





    