import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const GLOBE_RADIUS = 36;
const INITIAL_CAMERA_POSITION = { x: 75.953, y: 48.316, z: -61.209 };
const INITIAL_CAMERA_TARGET = { x: 13, y: 4, z: -2 };
const CAMERA_ORBIT_TRAVEL_RATIO = 0.1;
const CAMERA_ZOOM_IN_RATIO = 0.4;
const MARKER_DOT_RADIUS = 0.48;
const STATION_ART_SIZE = 3;
const STATION_ART_SIZE_ACTIVE = 4;

// Convert GPS coordinates to sphere coordinates
function convertGPSToSphere(latitude, longitude, radius = GLOBE_RADIUS) {
  const phi = (90 - latitude) * (Math.PI / 180);
  const theta = (180 + longitude) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

function stationCoordinates(station) {
  const latFromLocation = Number.parseFloat(station?.location?.lat);
  const lonFromLocation = Number.parseFloat(station?.location?.lon);
  if (Number.isFinite(latFromLocation) && Number.isFinite(lonFromLocation)) {
    return { lat: latFromLocation, lon: lonFromLocation };
  }

  const source = String(station?.coordinates || '').trim();
  if (!source) {
    return null;
  }
  const decimalMatch = source.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!decimalMatch) {
    return null;
  }
  const lat = Number.parseFloat(decimalMatch[1]);
  const lon = Number.parseFloat(decimalMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { lat, lon };
}

function StationsGlobe({ stations, activeStationId, onSelectStation }) {
  const containerRef = useRef(null);
  const onSelectStationRef = useRef(onSelectStation);
  const markerRefs = useRef([]);

  useEffect(() => {
    onSelectStationRef.current = onSelectStation;
  }, [onSelectStation]);

  const mappableStations = useMemo(() => {
    return (Array.isArray(stations) ? stations : [])
      .map((station) => {
        const coords = stationCoordinates(station);
        if (!coords) {
          return null;
        }
        return {
          station,
          id: station.id,
          art: station.art,
          lat: coords.lat,
          lon: coords.lon
        };
      })
      .filter(Boolean);
  }, [stations]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mappableStations.length === 0) {
      return undefined;
    }

    let rafId = 0;
    let observer = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(INITIAL_CAMERA_POSITION.x, INITIAL_CAMERA_POSITION.y, INITIAL_CAMERA_POSITION.z);
    camera.lookAt(INITIAL_CAMERA_TARGET.x, INITIAL_CAMERA_TARGET.y, INITIAL_CAMERA_TARGET.z);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.55;
    controls.target.set(INITIAL_CAMERA_TARGET.x, INITIAL_CAMERA_TARGET.y, INITIAL_CAMERA_TARGET.z);

    const initialOffset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const initialDistance = initialOffset.length();
    const initialSpherical = new THREE.Spherical().setFromVector3(initialOffset);
    const angleTravel = Math.PI * CAMERA_ORBIT_TRAVEL_RATIO;

    // Keep the camera very close to the authored starting pose.
    controls.minDistance = initialDistance * (1 - CAMERA_ZOOM_IN_RATIO);
    controls.maxDistance = initialDistance;
    controls.minAzimuthAngle = initialSpherical.theta - angleTravel;
    controls.maxAzimuthAngle = initialSpherical.theta + angleTravel;
    controls.minPolarAngle = Math.max(0.01, initialSpherical.phi - angleTravel);
    controls.maxPolarAngle = Math.min(Math.PI - 0.01, initialSpherical.phi + angleTravel);
    controls.update();

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    const innerSphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS - 0.9, 52, 26);
    const innerSphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000
    });
    const innerSphere = new THREE.Mesh(innerSphereGeometry, innerSphereMaterial);
    globeGroup.add(innerSphere);

    const sphereGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 52, 26);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x31322d, wireframe: true });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    globeGroup.add(sphere);

    const textureLoader = new THREE.TextureLoader();
    const rayTargets = [];
    const disposers = [];
    markerRefs.current = [];
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 128;
    maskCanvas.height = 128;
    const maskContext = maskCanvas.getContext('2d');
    if (maskContext) {
      maskContext.fillStyle = 'black';
      maskContext.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskContext.fillStyle = 'white';
      maskContext.beginPath();
      maskContext.arc(maskCanvas.width / 2, maskCanvas.height / 2, maskCanvas.width * 0.46, 0, Math.PI * 2);
      maskContext.fill();
    }
    const circleMaskTexture = new THREE.CanvasTexture(maskCanvas);
    circleMaskTexture.needsUpdate = true;

    for (const entry of mappableStations) {
      const isActive = entry.id === activeStationId;
      const dotGeometry = new THREE.SphereGeometry(MARKER_DOT_RADIUS, 10, 10);
      const dotMaterial = new THREE.MeshBasicMaterial({
        color: isActive ? 0xff8a00 : 0x7d7d7d
      });
      const dot = new THREE.Mesh(dotGeometry, dotMaterial);
      dot.position.copy(convertGPSToSphere(entry.lat, entry.lon, GLOBE_RADIUS + 1.4));
      dot.userData.station = entry.station;
      globeGroup.add(dot);
      rayTargets.push(dot);
      disposers.push(() => {
        dotGeometry.dispose();
        dotMaterial.dispose();
      });

      if (!entry.art) {
        continue;
      }

      const texture = textureLoader.load(entry.art);
      texture.colorSpace = THREE.SRGBColorSpace;
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        alphaMap: circleMaskTexture,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
        alphaTest: 0.2
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      const spriteSize = isActive ? STATION_ART_SIZE_ACTIVE : STATION_ART_SIZE;
      sprite.scale.set(spriteSize, spriteSize, 1);
      sprite.position.copy(convertGPSToSphere(entry.lat, entry.lon, GLOBE_RADIUS + 4.6));
      sprite.userData.station = entry.station;
      globeGroup.add(sprite);
      rayTargets.push(sprite);
      markerRefs.current.push({
        id: entry.id,
        dotMaterial,
        sprite
      });
      disposers.push(() => {
        texture.dispose();
        spriteMaterial.dispose();
      });
    }

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let isPointerDown = false;
    let pointerMoved = false;
    let pointerStartX = 0;
    let pointerStartY = 0;

    const handlePointerDown = (event) => {
      isPointerDown = true;
      pointerMoved = false;
      pointerStartX = event.clientX;
      pointerStartY = event.clientY;
    };

    const handlePointerMove = (event) => {
      if (!isPointerDown) {
        return;
      }
      if (Math.abs(event.clientX - pointerStartX) + Math.abs(event.clientY - pointerStartY) > 4) {
        pointerMoved = true;
      }
    };

    const handlePointerEnd = (event) => {
      if (!isPointerDown) {
        return;
      }
      isPointerDown = false;

      if (pointerMoved) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const intersections = raycaster.intersectObjects(rayTargets, false);
      const picked = intersections.find((entry) => entry?.object?.userData?.station)?.object?.userData?.station;
      if (picked) {
        onSelectStationRef.current?.(picked);
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerEnd);
    renderer.domElement.addEventListener('pointercancel', handlePointerEnd);

    let disposed = false;
    const animate = () => {
      if (disposed) {
        return;
      }
      controls.update();
      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    };
    rafId = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerEnd);
      renderer.domElement.removeEventListener('pointercancel', handlePointerEnd);
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', resize);
      }
      for (const dispose of disposers) {
        dispose();
      }
      markerRefs.current = [];
      innerSphereGeometry.dispose();
      innerSphereMaterial.dispose();
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      circleMaskTexture.dispose();
      controls.dispose();
      renderer.dispose();
      container.replaceChildren();
    };
  }, [mappableStations]);

  useEffect(() => {
    for (const marker of markerRefs.current) {
      const isActive = marker.id === activeStationId;
      marker.dotMaterial.color.setHex(isActive ? 0xff8a00 : 0x7d7d7d);
      if (marker.sprite) {
        const spriteSize = isActive ? STATION_ART_SIZE_ACTIVE : STATION_ART_SIZE;
        marker.sprite.scale.set(spriteSize, spriteSize, 1);
      }
    }
  }, [activeStationId]);

  return (
    <div className="stations-globe-wrap" aria-label="Stations globe map">
      <div ref={containerRef} className="stations-globe-canvas" />
      {mappableStations.length > 0 ? (
        <p className="stations-globe-hint">drag to orbit · tap marker to tune</p>
      ) : (
        <p className="stations-globe-empty">No station coordinates</p>
      )}
    </div>
  );
}

export default StationsGlobe;
