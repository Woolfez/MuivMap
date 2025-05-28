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

const loadAllFloorData = async () => {
    const promises = [];
    for (let i = 1; i <= FLOOR_COUNT; i++) {
        promises.push(
            fetch(`Floor${i}.svg`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ошибка ${response.status} для Floor${i}.svg`);
                    }
                    return response.text();
                })
                .then(svgText => {
                    floorData[i] = parseSVG(svgText, i);
                })
                .catch(error => console.error(`Ошибка загрузки этажа ${i}:`, error))
        );
    }
    await Promise.all(promises);
    console.log("Данные этажа загружены:", floorData);
    populateRoomDropdowns();
    buildGraph();
};

const buildGraph = () => {
    graph = { nodes: [], edges: {} };
    if (graphDebugLayer) {
        graphDebugLayer.getSource().clear();
    }
    let nodeIdCounter = 0;
    const nodeMap = {};
    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
        if (!floorData[floor]) continue;

        const addNodes = (nodesToAdd) => {
            nodesToAdd.forEach(node => {
                const graphNode = {
                    graphId: nodeIdCounter,
                    originalId: node.id,
                    svgId: node.svgId,
                    x: node.x,
                    y: node.y,
                    floor: node.floor,
                    isStair: node.isStair,
                };
                graph.nodes.push(graphNode);
                nodeMap[node.id] = graphNode.graphId;
                graph.edges[graphNode.graphId] = []; 
                if (graphDebugLayer) {
                    const nodeFeature = new ol.Feature({
                        geometry: new ol.geom.Point([node.x, node.y]),
                        type: node.isStair ? 'stair' : 'node',
                        floor: node.floor,
                        originalId: node.originalId
                    });
                    graphDebugLayer.getSource().addFeature(nodeFeature);
                }
                
                nodeIdCounter++;
            });
        };
        addNodes(floorData[floor].pathNodes);
        addNodes(floorData[floor].stairs);
    }

    const addedEdges = new Set();
    graph.nodes.forEach(nodeA => {
        graph.nodes.forEach(nodeB => {
            if (nodeA.graphId === nodeB.graphId) return;

            const dist = calculateDistance(nodeA, nodeB);

            const edgeKey = nodeA.graphId < nodeB.graphId ? `${nodeA.graphId}-${nodeB.graphId}` : `${nodeB.graphId}-${nodeA.graphId}`;
            if (nodeA.floor === nodeB.floor && dist < NODE_CONNECTION_THRESHOLD) {
                if(!nodeA.isStair || !nodeB.isStair) {
                     if (nodeA.isStair || nodeB.isStair) {
                         console.log(`[Построение графа] соединяет ${nodeA.isStair ? 'STAIR' : 'PATH'} точка ${nodeA.originalId}(${nodeA.graphId}) этаж ${nodeA.floor} в ${nodeB.isStair ? 'STAIR' : 'PATH'} точка ${nodeB.originalId}(${nodeB.graphId}) этаж ${nodeB.floor} дистанция: ${dist.toFixed(2)}`);
                     }
                     graph.edges[nodeA.graphId].push({ neighborId: nodeB.graphId, weight: dist });
                     graph.edges[nodeB.graphId].push({ neighborId: nodeA.graphId, weight: dist });
                     if (graphDebugLayer && !addedEdges.has(edgeKey)) {
                        const edgeFeature = new ol.Feature({
                            geometry: new ol.geom.LineString([[nodeA.x, nodeA.y], [nodeB.x, nodeB.y]]),
                            type: 'edge',
                            floor: nodeA.floor
                        });
                        graphDebugLayer.getSource().addFeature(edgeFeature);
                        addedEdges.add(edgeKey);
                     }
                 }
            } 
            if (nodeA.isStair && nodeB.isStair &&
                Math.abs(nodeA.floor - nodeB.floor) === 1) {
                 console.log(`[Построение графа - Проверка расстояние от лестницы] Сравнение лестниц: ${nodeA.originalId}(${nodeA.graphId}) этаж ${nodeA.floor} <-> ${nodeB.originalId}(${nodeB.graphId}) этаж ${nodeB.floor} дистанция: ${dist.toFixed(2)}`);
                 if (dist < STAIR_PROXIMITY_THRESHOLD) { 
                     console.log(`[Построение графа - Проверка расстояние соединения лестниц] Соединяющая лестница: ${nodeA.originalId}(${nodeA.graphId}) этаж ${nodeA.floor} в ${nodeB.originalId}(${nodeB.graphId}) этаж ${nodeB.floor}`);
                     graph.edges[nodeA.graphId].push({ neighborId: nodeB.graphId, weight: FLOOR_CHANGE_COST });
                     graph.edges[nodeB.graphId].push({ neighborId: nodeA.graphId, weight: FLOOR_CHANGE_COST });
                     const lowerFloor = Math.min(nodeA.floor, nodeB.floor);
                     if (graphDebugLayer && !addedEdges.has(edgeKey)) {
                         const edgeFeature = new ol.Feature({
                             geometry: new ol.geom.LineString([[nodeA.x, nodeA.y], [nodeB.x, nodeB.y]]),
                             type: 'edge',
                             floor: lowerFloor,
                             isStairConnection: true
                         });
                         graphDebugLayer.getSource().addFeature(edgeFeature);
                         addedEdges.add(edgeKey);
                     }
                 } 
            }
        });
    });

    for (const nodeId in graph.edges) {
        const uniqueEdges = [];
        const seenNeighbors = new Set();
        graph.edges[nodeId].forEach(edge => {
            if (!seenNeighbors.has(edge.neighborId)) {
                uniqueEdges.push(edge);
                seenNeighbors.add(edge.neighborId);
            }
        });
        graph.edges[nodeId] = uniqueEdges;
    }


    console.log("Граф построен:", graph);
    if (graphDebugLayer) {
        console.log("Элементы графа извлечены:", graphDebugLayer.getSource().getFeatures().length);
    }
};

const populateRoomDropdowns = () => {
    const startSelect = document.getElementById('start-room');
    const endSelect = document.getElementById('end-room');

    startSelect.innerHTML = '<option value="">Выберите начальную точку</option>';
    endSelect.innerHTML = '<option value="">Выберите конечную точку</option>';

    let allRoomsForDropdown = [];
    for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
        if (floorData[floor] && floorData[floor].rooms) {
            Object.values(floorData[floor].rooms).forEach(room => {
                allRoomsForDropdown.push({
                    value: `${room.floor}-${room.number}`,
                    text: `Этаж ${room.floor} ${room.dataName}`,
                    floor: room.floor,
                    number: room.number,
                    dataName: room.dataName
                });
            });
        }
    }

    const excludedDataNames = ['Туалет'];
    allRoomsForDropdown = allRoomsForDropdown.filter(room => {
        return !excludedDataNames.some(prefix => room.dataName.startsWith(prefix));
    });

    allRoomsForDropdown.sort((a, b) => {
        if (a.floor !== b.floor) {
            return a.floor - b.floor;
        }
        const numA = parseInt(a.dataName);
        const numB = parseInt(b.dataName);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }
        return a.dataName.localeCompare(b.dataName);
    });

    allRoomsForDropdown.forEach(room => {
        const option = document.createElement('option');
        option.value = room.value;
        option.textContent = room.text;
        startSelect.appendChild(option.cloneNode(true));
        endSelect.appendChild(option);
    });

    const nearestToiletOption = document.createElement('option');
    nearestToiletOption.value = "find-nearest-toilet";
    nearestToiletOption.textContent = "Ближайший туалет";
    endSelect.appendChild(nearestToiletOption);

};

const AStar = (startGraphId, endGraphId) => {
    const frontier = new SimplePriorityQueue();
    frontier.enqueue(0, startGraphId);
    const cameFrom = { [startGraphId]: null };
    const costSoFar = { [startGraphId]: 0 };

    const endNode = graph.nodes[endGraphId];
    if (!endNode) {
        console.error(`[A* ошибка] Конечная точка ${endGraphId} не найдена.`);
        return null;
    }

    let foundPath = false;
    while (!frontier.isEmpty()) {
        const currentGraphId = frontier.dequeue();

        if (currentGraphId === endGraphId) {
            foundPath = true;
            break;
        }

        const currentNode = graph.nodes[currentGraphId];
        if (!currentNode) {
            console.warn(`[A* ошибка] Текущая точка ${currentGraphId} не найдена.`);
            continue; 
        }
        const neighbors = graph.edges[currentGraphId] || [];

        neighbors.forEach(edge => {
            const neighborGraphId = edge.neighborId;
            const neighborNode = graph.nodes[neighborGraphId];
            if (!neighborNode) {
                 console.warn(`[A* ошибка] Соседняя точка ${neighborGraphId} не найдена.`);
                 return;
            }

            const newCost = costSoFar[currentGraphId] + edge.weight;

            if (!(neighborGraphId in costSoFar) || newCost < costSoFar[neighborGraphId]) {
                costSoFar[neighborGraphId] = newCost;
                const spatialHeuristic = calculateDistance(neighborNode, endNode);
                const floorDifference = Math.abs(neighborNode.floor - endNode.floor);
                const floorPenalty = floorDifference * FLOOR_CHANGE_COST;
                const heuristic = spatialHeuristic + floorPenalty;
                const priority = newCost + heuristic;
                frontier.enqueue(priority, neighborGraphId);
                cameFrom[neighborGraphId] = currentGraphId;
            }
        });
    }

const findNearestNode = (pointX, pointY, floor) => {
    let nearestNode = null;
    let minDistance = Infinity;

    graph.nodes.forEach(node => {
        if (node.floor === floor) {
            const dist = calculateDistance({ x: pointX, y: pointY }, node);
            if (dist < minDistance) {
                minDistance = dist;
                nearestNode = node;
            }
        }
    });
    return nearestNode;
};

const createPathSegments = (pathNodeGraphIds, startPoint, endPoint) => {
    if (!pathNodeGraphIds || pathNodeGraphIds.length === 0) {
        return {};
    }

    const segments = {};
    let currentSegment = [];
    let currentSegmentFloor = -1;
    currentSegment.push([startPoint.x, startPoint.y]);
    currentSegmentFloor = startPoint.floor;

    pathNodeGraphIds.forEach(graphId => {
        const node = graph.nodes[graphId];
        if (node.floor !== currentSegmentFloor) {
            if (currentSegment.length > 0) {
                 if (!segments[currentSegmentFloor]) segments[currentSegmentFloor] = [];
                 segments[currentSegmentFloor].push(currentSegment);
             }
            currentSegment = [[node.x, node.y]];
            currentSegmentFloor = node.floor;
        } else {
            currentSegment.push([node.x, node.y]);
        }
    });

const arrowHeadStyle = new ol.style.Style({
    fill: new ol.style.Fill({ color: PATH_COLOR }),
    stroke: new ol.style.Stroke({ color: PATH_COLOR, width: 1 })
});

const animatePath = () => {
    const elapsed = Date.now();
    currentDashOffset = -(elapsed / 1000 * ANIMATION_SPEED) % (DASH_PATTERN[0] + DASH_PATTERN[1]);
    
    if (pathLayer) {
        pathLayer.changed(); 
    }
    
    animationFrameId = requestAnimationFrame(animatePath);
};    

const startAnimation = () => {
    if (animationFrameId === null) { 
        animatePath(); 
    }
};

const stopAnimation = () => {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    currentDashOffset = 0;
};

const animatedPathStyleFunction = (feature) => {
    if (feature.get('floor') !== currentFloor) {
        return null;
    }

    const type = feature.get('type');
    const geometry = feature.getGeometry();

    if (type === 'path-segment' && geometry instanceof ol.geom.LineString) {
        const animatedStroke = new ol.style.Stroke({
            color: PATH_COLOR,
            width: PATH_WIDTH,
            lineDash: DASH_PATTERN,
            lineDashOffset: currentDashOffset
        });
        return new ol.style.Style({ stroke: animatedStroke });
    } else if (type === 'arrowhead' && geometry instanceof ol.geom.Polygon) {
        return arrowHeadStyle;
    }
    
    return null; 
};  

const initializePathLayer = () => {
    pathLayer = new ol.layer.Vector({
        source: new ol.source.Vector(),
        style: animatedPathStyleFunction, 
        zIndex: 5 
    });
    map.addLayer(pathLayer);
};

const createArrowheadFeature = (lineCoords, floor) => {
    if (!lineCoords || lineCoords.length < 2) {
        return null;
    }
    const start = lineCoords[lineCoords.length - 2]; 
    const end = lineCoords[lineCoords.length - 1];   

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const rotation = Math.atan2(dy, dx);

    const coords = [
        end,
        [
            end[0] - ARROW_HEAD_SIZE * Math.cos(rotation - Math.PI / 6),
            end[1] - ARROW_HEAD_SIZE * Math.sin(rotation - Math.PI / 6)
        ],
        [
            end[0] - ARROW_HEAD_SIZE * Math.cos(rotation + Math.PI / 6),
            end[1] - ARROW_HEAD_SIZE * Math.sin(rotation + Math.PI / 6)
        ],
        end 
    ];

    const arrowhead = new ol.Feature({
        geometry: new ol.geom.Polygon([coords]),
        type: 'arrowhead', 
        floor: floor
    });
    return arrowhead;
};

const drawPath = (pathSegments, startFloor, endFloor) => {
    if (!pathLayer) {
        initializePathLayer();
    }
    pathLayer.getSource().clear(); 
    stopAnimation(); 

    const features = [];
    let arrowAdded = false; 

    const finalFloor = endFloor;

    for (const floor in pathSegments) {
        const coords = pathSegments[floor];
        const currentSegmentFloor = parseInt(floor);

        if (coords.length >= 2) { 
            const lineFeature = new ol.Feature({
                geometry: new ol.geom.LineString(coords),
                type: 'path-segment'
            });
            lineFeature.set('floor', currentSegmentFloor); 
            features.push(lineFeature);
            if (currentSegmentFloor === finalFloor && !arrowAdded) {
                const arrowheadFeature = createArrowheadFeature(coords, currentSegmentFloor);
                if (arrowheadFeature) {
                    features.push(arrowheadFeature);
                    arrowAdded = true;
                }
            }
        }
    }

    if (features.length > 0) {
        pathLayer.getSource().addFeatures(features);
        startAnimation();
    }

    switchFloorWithAnimation(startFloor); 
    if (startFloor !== endFloor) {
        const delayForSecondSwitch = FLOOR_SWITCH_DELAY + ANIMATION_DURATION;
        setTimeout(() => {
            switchFloorWithAnimation(endFloor);
        }, delayForSecondSwitch);
    }
};

const projection = new ol.proj.Projection({
    code: 'indoor',
    units: 'pixels',
    extent: [0, 0, MAP_WIDTH, MAP_HEIGHT]
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

map = new ol.Map({
    target: 'map-layers-container',
    layers: [
        ...floorLayers,
    ],
    view: new ol.View({
        projection: projection,
        center: ol.extent.getCenter(projection.getExtent()),
        zoom: 0, 
        resolution: Math.max(MAP_WIDTH / window.innerWidth, MAP_HEIGHT / window.innerHeight) * 1.05,
        minResolution: 0.1, 
        maxResolution: 5 
    })
});
initializePathLayer(); 
initializeGraphDebugLayer();

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

const switchFloorWithAnimation = (floorNumber) => {
    if (floorNumber === currentFloor) {
        switchFloor(floorNumber); 
        return;
    }

    const mapLayersContainerElement = document.getElementById('map-layers-container');
    if (!mapLayersContainerElement) return;

    mapLayersContainerElement.classList.add('fade-out');

    setTimeout(() => {
        switchFloor(floorNumber);
        mapLayersContainerElement.classList.remove('fade-out'); 
    }, ANIMATION_DURATION);
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

document.querySelectorAll('.floor-btn').forEach(button => {
    button.addEventListener('click', () => {
        const floorNumber = parseInt(button.dataset.floor);
        switchFloorWithAnimation(floorNumber); 
    });
});


map.once('postrender', fitMapToView);
window.addEventListener('resize', () => {
    map.updateSize();
    fitMapToView();
});


window.addEventListener('resize', () => {
    map.updateSize();
    fitMapToView();
});
