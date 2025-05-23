const width = 771;
const height = 539;

const projection = new ol.proj.Projection({
    code: 'indoor',
    units: 'pixels',
    extent: [0, 0, width, height]
});
ol.proj.addProjection(projection);

const floorLayers = [1, 2, 3, 4, 5].map(floorNumber => {
    return new ol.layer.Image({
        visible: floorNumber === 1,
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
        zoom: 0, 
        minResolution: 0.2, 
        maxResolution: 2 
    })
});

function switchFloor(floorNumber) {
    floorLayers.forEach(layer => {
        layer.setVisible(layer.get('floor') === floorNumber);
    });
    fitMapToView();
    
    document.querySelectorAll('.floor-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.floor === floorNumber.toString());
    });
}


function fitMapToView() {
    const view = map.getView();
    const mapSize = map.getSize();
    
    if (!mapSize) return;
    const mapWidth = mapSize[0];
    const mapHeight = mapSize[1];
    const widthRatio = width / mapWidth;
    const heightRatio = height / mapHeight;
    const resolution = Math.max(widthRatio, heightRatio) * 1.02;
    
    view.setResolution(resolution);
    view.setCenter(ol.extent.getCenter(projection.getExtent()));
}


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

const parseSVG = (svgText, floorNumber) => {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, "image/svg+xml");
    const parsedData = { rooms: {}, doors: {}, pathNodes: [], stairs: [], toilets: [] };
    svgDoc.querySelectorAll('g#pathdots circle').forEach((circle, index) => {
        const svgX = parseFloat(circle.getAttribute('cx'));
        const svgY = parseFloat(circle.getAttribute('cy'));
        const id = circle.getAttribute('id') || `p${floorNumber}-${index}`;
        const coords = transformCoordinates(svgX, svgY);

        const nodeData = {
            id: id,
            svgId: circle.getAttribute('id'),
            x: coords.x,
            y: coords.y,
            floor: floorNumber,
            isStair: false,
            isPathNode: true,
        };

        if (nodeData.svgId && nodeData.svgId.startsWith('stair-marker')) {
            nodeData.isStair = true;
            nodeData.isPathNode = false;
            parsedData.stairs.push(nodeData);
        } else {
            parsedData.pathNodes.push(nodeData);
        }
    });

    svgDoc.querySelectorAll('g#Doors line').forEach(line => {
        const doorId = line.getAttribute('id');
        const dataName = line.getAttribute('data-name');
        if (!doorId || !dataName) return;

        const x1 = parseFloat(line.getAttribute('x1'));
        const y1 = parseFloat(line.getAttribute('y1'));
        const x2 = parseFloat(line.getAttribute('x2'));
        const y2 = parseFloat(line.getAttribute('y2'));

        const midSvgX = (x1 + x2) / 2;
        const midSvgY = (y1 + y2) / 2;
        const midCoords = transformCoordinates(midSvgX, midSvgY);

        const doorData = {
            id: doorId,
            dataName: dataName,
            x: midCoords.x,
            y: midCoords.y,
            floor: floorNumber,
        };
        parsedData.doors[doorId] = doorData;
        parsedData.rooms[doorId] = {
            number: doorId,
            dataName: dataName,
            floor: floorNumber,
            doorId: doorId, 
            doorCoords: { x: midCoords.x, y: midCoords.y },
        };
        if (dataName === 'Туалет') {
            parsedData.toilets.push(doorData);
        }
    });

    return parsedData;
};
