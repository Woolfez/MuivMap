const width = 842;
const height = 595;

const projection = new ol.proj.Projection({
    code: 'indoor',
    units: 'pixels',
    extent: [0, 0, width, height]
});
ol.proj.addProjection(projection);

// Create layers for all floors
const floorLayers = [1, 2, 3, 4, 5].map(floorNumber => {
    return new ol.layer.Image({
        visible: floorNumber === 1, // Only first floor visible initially
        source: new ol.source.ImageStatic({
            url: `floor${floorNumber}.svg`,
            imageExtent: projection.getExtent(),
            projection: projection,
            imageSize: [width, height]
        }),
        properties: {
            floor: floorNumber
        }
    });
});

const map = new ol.Map({
    target: 'map',
    layers: floorLayers,
    view: new ol.View({
        projection: projection,
        center: ol.extent.getCenter(projection.getExtent()),
        zoom: 0, // Start at base zoom level
        minResolution: 0.2, // Prevent over-zooming
        maxResolution: 2 // Prevent under-zooming
    })
});

// Floor switching functionality
function switchFloor(floorNumber) {
    floorLayers.forEach(layer => {
        layer.setVisible(layer.get('floor') === floorNumber);
    });
    fitMapToView();
    
    // Update button states
    document.querySelectorAll('.floor-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.floor === floorNumber.toString());
    });
}


function fitMapToView() {
    const view = map.getView();
    const mapSize = map.getSize();
    
    if (!mapSize) return;
    
    // Calculate exact resolution while preserving aspect ratio
    const mapWidth = mapSize[0];
    const mapHeight = mapSize[1];
    const widthRatio = width / mapWidth;
    const heightRatio = height / mapHeight;
    const resolution = Math.max(widthRatio, heightRatio) * 1.02; // 2% buffer
    
    view.setResolution(resolution);
    view.setCenter(ol.extent.getCenter(projection.getExtent()));
}

// Initial fit
map.once('postrender', fitMapToView);

// Handle window resize
window.addEventListener('resize', () => {
    map.updateSize();
    fitMapToView();
});

// Add floor button click handlers
document.querySelectorAll('.floor-btn').forEach(button => {
    button.addEventListener('click', () => {
        const floorNumber = parseInt(button.dataset.floor);
        switchFloor(floorNumber);
    });
});