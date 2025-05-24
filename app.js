const WIDTH = 771;
const HEIGHT = 539;
const FLOOR_COUNT = 5;
const SVG_VIEWBOX_WIDTH = 771;
const SVG_VIEWBOX_HEIGHT = 539;

let floorData = {};
let graph = { nodes: [], edges: {} };
let currentFloor = 1;
let pathLayer = null;
let graphDebugLayer = null;
let map = null;

class SimplePriorityQueue {
    constructor() {
        this._nodes = [];
    }

    enqueue(priority, key) {
        this._nodes.push({ key: key, priority: priority });
        this.sort();
    }

    dequeue() {
        return this._nodes.shift().key;
    }

    sort() {
        this._nodes.sort((a, b) => a.priority - b.priority);
    }

    isEmpty() {
        return !this._nodes.length;
    }
}

const calculateDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const transformCoordinates = (svgX, svgY) => {
    const mapX = svgX * (MAP_WIDTH / SVG_VIEWBOX_WIDTH);
    const mapY = (SVG_VIEWBOX_HEIGHT - svgY) * (MAP_HEIGHT / SVG_VIEWBOX_HEIGHT);
    return { x: mapX, y: mapY };
};

const projection = new ol.proj.Projection({
    code: 'indoor',
    units: 'pixels',
    extent: [0, 0, width, height]
});
ol.proj.addProjection(projection);

const floorLayers = Array.from({ length: FLOOR_COUNT }, (_, i) => i + 1).map(floorNumber => {
    return new ol.layer.Image({
        visible: floorNumber === currentFloor,
        source: new ol.source.ImageStatic({
            url: `Floor${floorNumber}.svg`,
            imageExtent: projection.getExtent(),
            projection: projection,
            imageSize: [MAP_WIDTH, MAP_HEIGHT]
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
        zoom: 0, 
        minResolution: 0.2, 
        maxResolution: 2 
    })
});

const switchFloor = (floorNumber) => {
    if (currentFloor === floorNumber && map.getLayers().getArray().some(l => l === pathLayer)) {
         if (pathLayer) pathLayer.changed();
         return;
     }

    currentFloor = floorNumber;
    floorLayers.forEach(layer => {
        layer.setVisible(layer.get('floor') === currentFloor);
    });

    if (pathLayer) {
        pathLayer.changed(); 
    }
    
    if (graphDebugLayer) {
        graphDebugLayer.changed();
    }

    document.querySelectorAll('.floor-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.floor === currentFloor.toString());
    });
};



const fitMapToView = () => {
    const view = map.getView();
    const mapSize = map.getSize(); 

    if (!mapSize || mapSize[0] <= 0 || mapSize[1] <= 0) return;
    const xResolution = projection.getExtent()[2] / mapSize[0];
    const yResolution = projection.getExtent()[3] / mapSize[1];
    const resolution = Math.max(xResolution, yResolution) * 1.02;
    
    view.setResolution(resolution);
    view.setCenter(ol.extent.getCenter(projection.getExtent()));
};


map.once('postrender', fitMapToView);


window.addEventListener('resize', () => {
    map.updateSize();
    fitMapToView();
});


document.querySelectorAll('.floor-btn').forEach(button => {
    button.addEventListener('click', () => {
        const floorNumber = parseInt(button.dataset.floor);
        switchFloor(floorNumber);
    });
});
