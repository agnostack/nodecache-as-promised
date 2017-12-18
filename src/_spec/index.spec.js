/* eslint max-nested-callbacks: 0 */
import createCacheInstance from '../'
import expect from 'expect.js'
import sinon from 'sinon'
import {dummyLog} from './log-helper'

const dummyKey = 'hei/verden'
const cacheValue = {
  keyNamespace: 'valueAsString'
}
const preCached = {
  [dummyKey]: cacheValue
}

describe('CacheManager', () => {
  describe('instantation', () => {
    it('should create a new empty instance', () => {
      const cacheInstance = createCacheInstance({}, {})
      expect(cacheInstance).to.be.a(Object)
      expect(cacheInstance.cache.itemCount).to.equal(0)
    })

    it('should create a new prefilled instance with a cloned copy', () => {
      const obj = {hei: 'verden'}
      const cacheInstance = createCacheInstance({initial: obj})
      obj.hei = 'world'
      expect(cacheInstance).to.be.a(Object)
      expect(cacheInstance.cache.itemCount).to.equal(1)
      expect(cacheInstance.cache.get('hei').value).to.equal('verden')
      expect(cacheInstance.cache.get('hei').cache).to.equal('hit')
    })
  })

  describe('-> hot cache', () => {
    let cacheInstance
    let spy

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: preCached})
      const p = () => Promise.resolve()
      spy = sinon.spy(p)
    })

    it('should return cached content if not stale', () => {
      return cacheInstance.get(dummyKey, {}, spy).then((obj) => {
        expect(obj.value).to.eql(cacheValue)
        expect(obj.cache).to.equal('hit')
        expect(spy.called).to.equal(false)
      })
    })
  })

  describe('-> cold/stale cache', () => {
    let cacheInstance
    let spy
    let now

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: preCached})
      const staleObj = {...cacheInstance.cache.get(dummyKey), TTL: -1000}
      cacheInstance.cache.set(dummyKey, staleObj)
      now = Date.now()
      const p = () => new Promise((resolve) => {
        setTimeout(() => resolve(now), 10)
      })
      spy = sinon.spy(p)
    })

    it('should return promised content when key is not present', () => {
      return cacheInstance.get('N/A', {}, spy).then((obj) => {
        expect(obj.value).to.eql(now)
        expect(obj.cache).to.equal('miss')
        expect(spy.called).to.equal(true)
      })
    })

    it('should return undefined if no promise is given', () => {
      return cacheInstance.get('N/A').then((obj) => {
        expect(obj).to.be(null)
      })
    })

    it('should return promised content if cache is stale', () => {
      return cacheInstance.get(dummyKey, {}, spy).then((obj) => {
        expect(obj.value).to.eql(now)
        expect(obj.cache).to.equal('miss')
        expect(spy.called).to.equal(true)
      })
    })
  })

  describe('-> worker queue', () => {
    let cacheInstance
    let spy
    let now

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: preCached})
      const staleObj = {...cacheInstance.cache.get(dummyKey), TTL: -1000}
      cacheInstance.cache.set(dummyKey, staleObj)
      now = Date.now()
      const p = () => new Promise((resolve) => {
        setTimeout(() => resolve(now), 10)
      })
      spy = sinon.spy(p)
    })

    it('should run only one promise, while two requests asks for data from cold cache concurrently', () => {
      return Promise.all([
        cacheInstance.get(dummyKey, {}, spy),
        cacheInstance.get(dummyKey, {}, spy)
      ]).then(([val1, val2]) => {
        expect(val1.value).to.eql(val2.value)
        expect(spy.callCount).to.equal(1)
        expect(val1.cache).to.equal('miss')
        expect(val2.cache).to.equal('hit')
      })
    })
  })

  describe('-> error handling (timeouts)', () => {
    let cacheInstance

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: preCached, log: dummyLog})
      const staleObj = {...cacheInstance.cache.get(dummyKey), TTL: -1000}
      cacheInstance.cache.set(dummyKey, staleObj)
    })

    it('should return stale cache and increase wait if promise reaches timeout', () => {
      const p = () => new Promise((resolve) => {
        setTimeout(() => resolve('another object'), 1000)
      })
      const timeoutSpy = sinon.spy(p)
      expect(cacheInstance.waiting.get(dummyKey)).to.be.a('undefined')
      return cacheInstance.get(dummyKey, { workerTimeout: 0 }, timeoutSpy).then((obj) => {
        expect(timeoutSpy.called).to.equal(true)
        expect(cacheInstance.waiting.get(dummyKey)).not.to.equal(0)
        expect(obj.value).to.eql(cacheValue)
        expect(obj.cache).to.equal('stale')
      })
    })

    it('should reject if cache is cold and a timeout occurs', () => {
      const p = () => new Promise((resolve) => {
        setTimeout(() => resolve('another object'), 1000)
      })
      const timeoutSpy = sinon.spy(p)
      return cacheInstance.get(dummyKey, {workerTimeout: 0}, timeoutSpy)
      .catch((err) => {
        expect(timeoutSpy.called).to.equal(true)
        expect(err).to.be.an(Error)
      })
    })

    it('should re-run promise after deltaWait time has passed', (done) => {
      const p = () => new Promise((resolve) => {
        setTimeout(() => resolve('another object'), 1000)
      })
      const p2 = () => Promise.resolve('hei verden')
      const timeoutSpy = sinon.spy(p)
      const resolveSpy = sinon.spy(p2)
      const conf = {
        deltaWait: 10,
        workerTimeout: 10
      }
      cacheInstance.get(dummyKey, conf, timeoutSpy).then((obj) => {
        // 1. should return stale cache when timeout occurs
        expect(obj.value).to.eql(cacheValue)
        expect(cacheInstance.waiting.get(dummyKey).wait).to.equal(10)
        return cacheInstance.get(dummyKey, conf, resolveSpy).then((obj) => {
          // 2. should return stale cache before wait period has finished
          expect(obj.cache).to.equal('stale')
          expect(obj.value).to.eql(cacheValue)
          setTimeout(() => {
            return cacheInstance.get(dummyKey, conf, resolveSpy).then((obj) => {
              // 3. should return fresh data when wait period has finished
              expect(obj.value).to.eql('hei verden')
              expect(obj.cache).to.equal('miss')
              done()
            })
          }, 10)
        })
      }).catch(done)
    })
  })

  describe('-> error handling (rejections)', () => {
    let cacheInstance

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: preCached, log: dummyLog})
      const staleObj = {...cacheInstance.cache.get(dummyKey), TTL: -1000}
      cacheInstance.cache.set(dummyKey, staleObj)
    })

    it('should return stale cache and set wait if a promise rejection occurs', () => {
      const p = () => Promise.reject(new Error('an error occurred'))
      const rejectionSpy = sinon.spy(p)
      expect(cacheInstance.waiting.get(dummyKey)).to.be.a('undefined')
      return cacheInstance.get(dummyKey, {}, rejectionSpy).then((obj) => {
        expect(rejectionSpy.called).to.equal(true)
        expect(cacheInstance.waiting.get(dummyKey)).not.to.equal(0)
        expect(obj.value).to.eql(cacheValue)
        expect(obj.cache).to.equal('stale')
      })
    })

    it('should reject if cache is cold and a rejection occurs', () => {
      const p = () => Promise.reject(new Error('an error occurred'))
      const rejectionSpy = sinon.spy(p)
      return cacheInstance.get(dummyKey, {}, rejectionSpy).catch((err) => {
        expect(rejectionSpy.called).to.equal(true)
        expect(err).to.be.an(Error)
      })
    })

    it('should reject if an Error is thrown', () => {
      const p = () => {
        throw new Error('an error occurred')
      }
      const rejectionSpy = sinon.spy(p)
      return cacheInstance.get(dummyKey, {}, rejectionSpy).catch((err) => {
        expect(rejectionSpy.called).to.equal(true)
        expect(err).to.be.an(Error)
      })
    })

    it('should re-run promise after deltaWait time has passed (when failing caused by a rejection)', (done) => {
      const p = () => Promise.reject(new Error(''))
      const p2 = () => Promise.resolve('hei verden')
      const rejectionSpy = sinon.spy(p)
      const resolveSpy = sinon.spy(p2)
      const conf = {
        deltaWait: 10
      }
      cacheInstance.get(dummyKey, conf, rejectionSpy).then((obj) => {
        // 1. should return stale cache when rejection occurs
        expect(obj.value).to.eql(cacheValue)
        return cacheInstance.get(dummyKey, conf, resolveSpy).then((obj) => {
          // 2. should return stale cache before wait period has finished
          expect(obj.value).to.eql(cacheValue)
          expect(obj.cache).to.equal('stale')
          setTimeout(() => {
            return cacheInstance.get(dummyKey, conf, resolveSpy).then((obj) => {
              // 3. should return fresh data when wait period has finished
              expect(obj.value).to.eql('hei verden')
              expect(obj.cache).to.equal('miss')
              done()
            })
          }, 10)
        })
      }).catch(done)
    })

    it('should re-run promise after deltaWait time has passed (when failing caused by a rejection and cache is cold)', (done) => {
      const p = () => Promise.reject(new Error(''))
      const rejectionSpy = sinon.spy(p)
      const conf = {
        deltaWait: 10
      }
      cacheInstance.get('N/A', conf, rejectionSpy).catch((err) => {
        expect(err).to.be.an(Error)
        expect(rejectionSpy.callCount).to.equal(1)
        cacheInstance.get('N/A', conf, rejectionSpy).catch((err) => {
          expect(err).to.be.an(Error)
          expect(rejectionSpy.callCount).to.equal(1)
          cacheInstance.set('N/A', 'hei verden')
          cacheInstance.waiting.delete('N/A')
          setTimeout(() => {
            return cacheInstance.get('N/A', conf, rejectionSpy).then((obj) => {
              expect(rejectionSpy.callCount).to.equal(1)
              expect(obj.value).to.eql('hei verden')
              expect(obj.cache).to.equal('hit')
              done()
            })
          }, 10)
        })
      }).catch(done)
    })

    it('should increase deltaWait after several re-runs', (done) => {
      const p = () => Promise.reject(new Error(''))
      const rejectionSpy = sinon.spy(p)
      const conf = {
        deltaWait: 10
      }
      expect(cacheInstance.waiting.get('N/A')).to.be.a('undefined')
      cacheInstance.get('N/A', conf, rejectionSpy).catch((err) => {
        expect(err).to.be.an(Error)
        expect(rejectionSpy.callCount).to.equal(1)
        expect(cacheInstance.waiting.get('N/A').wait).to.equal(10)
        const {started} = cacheInstance.waiting.get('N/A')
        cacheInstance.get('N/A', conf, rejectionSpy).catch((err) => {
          expect(err).to.be.an(Error)
          expect(rejectionSpy.callCount).to.equal(1)
          expect(cacheInstance.waiting.get('N/A')).to.eql({
            started,
            wait: 10
          })
          setTimeout(() => {
            return cacheInstance.get('N/A', conf, rejectionSpy).catch((err) => {
              expect(err).to.be.an(Error)
              expect(rejectionSpy.callCount).to.equal(2)
              expect(cacheInstance.waiting.get('N/A').wait).to.equal(10)
              expect(cacheInstance.waiting.get('N/A').started).not.to.equal(started)
              done()
            })
          }, 10)
        })
      }).catch(done)
    })
  })

  describe('-> expire', () => {
    let cacheInstance

    beforeEach(() => {
      cacheInstance = createCacheInstance({initial: {
        'house/1': {hei: 'verden'},
        'house/2': {hei: 'verden'},
        'guest/2': {hei: 'verden'}
      }})
    })

    it('should expire all house keys', () => {
      cacheInstance.expire(['house/*'])
      expect(cacheInstance.cache.get('house/1').TTL).to.equal(0)
      expect(cacheInstance.cache.get('house/2').TTL).to.equal(0)
      expect(cacheInstance.cache.get('guest/2').TTL).not.to.equal(0)
    })

    it('should expire given house keys', () => {
      cacheInstance.expire(['house/*', 'guest/2'])
      expect(cacheInstance.cache.get('house/1').TTL).to.equal(0)
      expect(cacheInstance.cache.get('house/2').TTL).to.equal(0)
      expect(cacheInstance.cache.get('guest/2').TTL).to.equal(0)
    })
  })

  describe('-> LRU capabilities', () => {
    it('should throw away first entered entry', () => {
      const cacheInstance = createCacheInstance({initial: {
        'house/1': {hei: 'verden'},
        'house/2': {hei: 'verden'},
        'guest/3': {hei: 'verden'}
      },
        maxLength: 2})
      expect(cacheInstance.cache.itemCount).to.equal(2)
      expect(cacheInstance.cache.keys()).to.eql(['guest/3', 'house/2'])
    })
  })
})